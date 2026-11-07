import 'package:flutter/material.dart';
import 'package:dpad/dpad.dart';
import 'tv_player_screen.dart';

class TvHomeScreen extends StatelessWidget {
  const TvHomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final channels = [
      {'name': 'Banglar Voice Live TV', 'url': 'https://example.com/live.m3u8'},
      {'name': 'BV News 24/7', 'url': 'https://example.com/news.m3u8'},
    ];

    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(title: const Text('Banglar Voice TV'), backgroundColor: Colors.black),
      body: ListView.builder(
        itemCount: channels.length,
        itemBuilder: (context, index) {
          return DpadFocusable(
            onSelect: () {
              Navigator.push(context, MaterialPageRoute(
                builder: (_) => TvPlayerScreen(title: channels[index]['name']!, url: channels[index]['url']!)
              ));
            },
            child: Card(
              color: Colors.grey[900],
              margin: const EdgeInsets.all(16),
              child: ListTile(
                leading: const Icon(Icons.live_tv, color: Colors.red, size: 40),
                title: Text(channels[index]['name']!, style: const TextStyle(color: Colors.white, fontSize: 20)),
              ),
            ),
          );
        },
      ),
    );
  }
}
