import 'dart:async';
import 'dart:convert';

import 'package:bv_shared/bv_shared.dart' show JwtRefresh, JwtRefreshOutcome;
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../config.dart';

class AdminSession {
  AdminSession._();

  static bool _logged = false;
  static String? _email;
  static String? _token;
  static String? _refreshToken;
  static Future<bool>? _inflight;

  static bool get isLogged => _logged;
  static String? get email => _email;
  static String? get token => _token;

  /// Load saved session on app start and renew an expired access token.
  static Future<void> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      _email = prefs.getString(AdminConfig.emailKey);
      _token = prefs.getString(AdminConfig.tokenKey);
      _refreshToken = prefs.getString(AdminConfig.refreshKey);
      _logged = _token != null && _token!.isNotEmpty;
    } catch (_) {
      _logged = false;
    }
    if (_logged) await ensureFresh();
  }

  /// Makes sure the access token is valid, renewing it with the refresh token
  /// when it is expired or about to expire. Returns false when the session can
  /// no longer be used and the user must log in again.
  static Future<bool> ensureFresh({bool force = false}) {
    if (!_logged) return Future.value(false);
    if (!force && !JwtRefresh.isExpiring(_token)) return Future.value(true);
    return _inflight ??= _renew().whenComplete(() => _inflight = null);
  }

  static Future<bool> _renew() async {
    final rt = _refreshToken;
    if (rt == null || rt.isEmpty) {
      // Session saved by an older app version: usable only until it expires.
      if (JwtRefresh.isExpiring(_token, within: Duration.zero)) {
        await logout();
        return false;
      }
      return true;
    }
    final r = await JwtRefresh.refresh(
      supabaseUrl: AdminConfig.supabaseUrl,
      anonKey: AdminConfig.supabaseAnonKey,
      refreshToken: rt,
    );
    if (r.outcome == JwtRefreshOutcome.ok && r.tokens != null) {
      _token = r.tokens!.accessToken;
      _refreshToken = r.tokens!.refreshToken;
      await _persistTokens();
      return true;
    }
    if (r.outcome == JwtRefreshOutcome.rejected) {
      await logout();
      return false;
    }
    // Network problem: keep the session while the current token still works.
    return !JwtRefresh.isExpiring(_token, within: Duration.zero);
  }

  static Future<void> _persistTokens() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      if (_token != null) {
        await prefs.setString(AdminConfig.tokenKey, _token!);
      }
      if (_refreshToken != null) {
        await prefs.setString(AdminConfig.refreshKey, _refreshToken!);
      }
    } catch (_) {}
  }

  /// Login via Supabase email + password. Returns true on success.
  static Future<bool> login(String email, String password) async =>
      (await loginWithReason(email, password)) == null;

  /// Login via Supabase email + password.
  /// Returns null on success, or a user-facing reason on failure.
  static Future<String?> loginWithReason(String email, String password) async {
    if (AdminConfig.supabaseUrl.isEmpty || AdminConfig.supabaseAnonKey.isEmpty) {
      return 'অ্যাপ কনফিগার করা নেই (Supabase সেটিং ছাড়া বিল্ড) — নতুন APK বিল্ড করুন';
    }
    try {
      final url = Uri.parse(
        '${AdminConfig.supabaseUrl}/auth/v1/token?grant_type=password',
      );
      final res = await http
          .post(
            url,
            headers: {
              'apikey': AdminConfig.supabaseAnonKey,
              'Content-Type': 'application/json',
            },
            body: jsonEncode({'email': email, 'password': password}),
          )
          .timeout(const Duration(seconds: 15));

      if (res.statusCode == 400 ||
          res.statusCode == 401 ||
          res.statusCode == 422) {
        return 'ভুল ইমেইল বা পাসওয়ার্ড';
      }
      if (res.statusCode != 200) {
        return 'সার্ভার সমস্যা (${res.statusCode}) — একটু পরে আবার চেষ্টা করুন';
      }

      final data = jsonDecode(res.body) as Map<String, dynamic>;
      final token = data['access_token'] as String?;
      final refresh = data['refresh_token'] as String?;
      final user = data['user'] as Map<String, dynamic>?;
      if (token == null || user == null) return 'লগইন ব্যর্থ — আবার চেষ্টা করুন';

      // Verify admin role via Supabase
      final profileUrl = Uri.parse(
        '${AdminConfig.supabaseUrl}/rest/v1/profiles?select=role&id=eq.${user['id']}',
      );
      final profileRes = await http
          .get(
            profileUrl,
            headers: {
              'apikey': AdminConfig.supabaseAnonKey,
              'Authorization': 'Bearer $token',
              'Accept': 'application/json',
            },
          )
          .timeout(const Duration(seconds: 15));

      if (profileRes.statusCode != 200) {
        return 'প্রোফাইল পড়া যায়নি (${profileRes.statusCode})';
      }

      final profiles = jsonDecode(profileRes.body) as List;
      if (profiles.isEmpty) return 'এই অ্যাকাউন্টের প্রোফাইল পাওয়া যায়নি';

      final role = profiles.first['role'] as String?;
      const allowed = ['admin', 'chief_editor', 'desk_editor'];
      if (role == null || !allowed.contains(role)) {
        final shown = role ?? 'নেই';
        return 'এই অ্যাকাউন্ট দিয়ে অ্যাডমিন অ্যাপে ঢোকা যাবে না (রোল: $shown)';
      }

      _logged = true;
      _email = email;
      _token = token;
      _refreshToken = refresh;

      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(AdminConfig.emailKey, email);
      await prefs.setString(AdminConfig.tokenKey, token);
      if (refresh != null) {
        await prefs.setString(AdminConfig.refreshKey, refresh);
      }
      await prefs.setBool(AdminConfig.sessionKey, true);
      return null;
    } catch (_) {
      return 'ইন্টারনেট সংযোগ নেই বা সার্ভার সাড়া দিচ্ছে না';
    }
  }

  static Future<void> logout() async {
    _logged = false;
    _email = null;
    _token = null;
    _refreshToken = null;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(AdminConfig.emailKey);
      await prefs.remove(AdminConfig.tokenKey);
      await prefs.remove(AdminConfig.refreshKey);
      await prefs.remove(AdminConfig.sessionKey);
    } catch (_) {}
  }
}
