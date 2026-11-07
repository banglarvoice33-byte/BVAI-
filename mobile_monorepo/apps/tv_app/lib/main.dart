import 'package:flutter/material.dart';
import 'package:dpad/dpad.dart';
import 'src/screens/tv_home_screen.dart';

void main() {
  runApp(const TvApp());
}

class TvApp extends StatelessWidget {
  const TvApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Banglar Voice TV',
      debugShowCheckedModeBanner: false,
      theme: ThemeData.dark(),
      builder: Dpad.wrap(), // টিভি রিমোট নেভিগেশনের জন্য
      home: const TvHomeScreen(),
    );
  }
}
