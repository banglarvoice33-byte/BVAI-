/// Supabase access-token helpers shared by the authenticated apps.
///
/// Supabase access tokens expire after about one hour. The apps used to keep
/// only the access token, so every call silently failed (empty dashboards,
/// reports stuck in the queue) one hour after login. These helpers read the
/// token expiry and renew the token with the saved refresh token.
library;

import 'dart:convert';

import 'package:http/http.dart' as http;

/// A fresh pair of tokens returned by Supabase Auth.
class JwtTokens {
  const JwtTokens({required this.accessToken, required this.refreshToken});

  final String accessToken;
  final String refreshToken;
}

enum JwtRefreshOutcome {
  /// New tokens were issued.
  ok,

  /// Supabase refused the refresh token: the user must log in again.
  rejected,

  /// Network or server problem: keep the session and try again later.
  unreachable,
}

class JwtRefreshResult {
  const JwtRefreshResult(this.outcome, [this.tokens]);

  final JwtRefreshOutcome outcome;
  final JwtTokens? tokens;
}

class JwtRefresh {
  JwtRefresh._();

  /// True when [jwt] is missing, unreadable, or expires within [within].
  static bool isExpiring(
    String? jwt, {
    Duration within = const Duration(minutes: 2),
  }) {
    if (jwt == null || jwt.isEmpty) return true;
    try {
      final parts = jwt.split('.');
      if (parts.length != 3) return true;
      final payload = utf8.decode(
        base64Url.decode(base64Url.normalize(parts[1])),
      );
      final exp = (jsonDecode(payload) as Map<String, dynamic>)['exp'];
      if (exp is! num) return true;
      final expiresAt = DateTime.fromMillisecondsSinceEpoch(
        exp.toInt() * 1000,
        isUtc: true,
      );
      return DateTime.now().toUtc().isAfter(expiresAt.subtract(within));
    } catch (_) {
      return true;
    }
  }

  /// Exchanges [refreshToken] for a new access/refresh token pair.
  static Future<JwtRefreshResult> refresh({
    required String supabaseUrl,
    required String anonKey,
    required String refreshToken,
  }) async {
    try {
      final res = await http
          .post(
            Uri.parse('$supabaseUrl/auth/v1/token?grant_type=refresh_token'),
            headers: {'apikey': anonKey, 'Content-Type': 'application/json'},
            body: jsonEncode({'refresh_token': refreshToken}),
          )
          .timeout(const Duration(seconds: 12));
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body) as Map<String, dynamic>;
        final access = data['access_token'] as String?;
        final refresh = data['refresh_token'] as String?;
        if (access != null && refresh != null) {
          return JwtRefreshResult(
            JwtRefreshOutcome.ok,
            JwtTokens(accessToken: access, refreshToken: refresh),
          );
        }
        return const JwtRefreshResult(JwtRefreshOutcome.rejected);
      }
      if (res.statusCode == 429 || res.statusCode >= 500) {
        return const JwtRefreshResult(JwtRefreshOutcome.unreachable);
      }
      return const JwtRefreshResult(JwtRefreshOutcome.rejected);
    } catch (_) {
      return const JwtRefreshResult(JwtRefreshOutcome.unreachable);
    }
  }
}
