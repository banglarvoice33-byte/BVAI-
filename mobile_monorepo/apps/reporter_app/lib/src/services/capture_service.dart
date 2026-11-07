/// Capture + location adapters.
library;

import 'dart:io' show File;

import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';

import '../models.dart';

class CaptureResult {
  final String? filePath;
  final String label;
  final CaptureMode mode;

  const CaptureResult({this.filePath, required this.label, required this.mode});
}

class CaptureService {
  CaptureService._();
  static final CaptureService instance = CaptureService._();

  Future<CaptureResult> capture(CaptureMode mode) async {
    switch (mode) {
      case CaptureMode.photo:
        return _takePhoto();
      case CaptureMode.video:
        return const CaptureResult(
          label: 'ভিডিও রেকর্ড (ক্যামেরা প্লাগইন লাগবে)',
          mode: CaptureMode.video,
        );
      case CaptureMode.audio:
        return const CaptureResult(
          label: 'অডিও রেকর্ড (mic প্লাগইন লাগবে)',
          mode: CaptureMode.audio,
        );
      case CaptureMode.text:
        return const CaptureResult(
          label: 'টেক্সট নোট — সরাসরি লিখুন',
          mode: CaptureMode.text,
        );
    }
  }

  Future<CaptureResult> _takePhoto() async {
    try {
      final shot = await ImagePicker().pickImage(
        source: ImageSource.camera,
        imageQuality: 80,
        maxWidth: 1920,
      );
      if (shot == null) {
        return const CaptureResult(
          label: 'ছবি তোলা বাতিল হয়েছে',
          mode: CaptureMode.photo,
        );
      }
      var path = shot.path;
      try {
        final dir = await getApplicationDocumentsDirectory();
        final dest =
            '${dir.path}/report_${DateTime.now().microsecondsSinceEpoch}.jpg';
        await File(shot.path).copy(dest);
        path = dest;
      } catch (_) {}
      return CaptureResult(
        filePath: path,
        label: 'ছবি তোলা হয়েছে',
        mode: CaptureMode.photo,
      );
    } catch (e) {
      return CaptureResult(
        label: 'ক্যামেরা খোলা যায়নি: $e',
        mode: CaptureMode.photo,
      );
    }
  }

  Future<String> transcribe(String? mediaPath) async {
    return 'ট্রান্সক্রিপশন আসবে AI সার্ভিস থেকে (BV_AI_PROCESS_URL সেট করলে)।';
  }

  Future<String> summarize(String body) async {
    return 'AI সারাংশ: এখানে ৩টি বুলেট আসবে যখন AI endpoint যুক্ত হবে।';
  }
}

class LocationResult {
  final double? lat;
  final double? lng;
  final String label;
  final String rawTag;

  const LocationResult({
    this.lat,
    this.lng,
    required this.label,
    required this.rawTag,
  });
}

class LocationService {
  LocationService._();
  static final LocationService instance = LocationService._();

  Future<LocationResult> current() async {
    return const LocationResult(
      lat: null,
      lng: null,
      label: '📍 অবস্থান যোগ করুন (জিপিএস প্লাগইন লাগবে)',
      rawTag: 'অজানা অবস্থান',
    );
  }

  String timestamp(DateTime t) {
    final h = t.hour.toString().padLeft(2, '0');
    final m = t.minute.toString().padLeft(2, '0');
    final d = '${t.day}/${t.month}/${t.year}';
    return '$d · $h:$m';
  }
}
