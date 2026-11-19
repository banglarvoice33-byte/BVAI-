import 'package:flutter/material.dart';
import 'package:camera/camera.dart';
import 'package:rtmp_broadcaster/camera.dart';
import 'package:permission_handler/permission_handler.dart';

class LiveStreamScreen extends StatefulWidget {
  final String rtmpUrl; 
  const LiveStreamScreen({super.key, required this.rtmpUrl});

  @override
  State<LiveStreamScreen> createState() => _LiveStreamScreenState();
}

class _LiveStreamScreenState extends State<LiveStreamScreen> {
  CameraController? _controller;
  bool _isStreaming = false;

  @override
  void initState() {
    super.initState();
    _initCamera();
  }

  Future<void> _initCamera() async {
    await [Permission.camera, Permission.microphone].request();
    final cameras = await availableCameras();
    if (cameras.isEmpty) return;

    _controller = CameraController(
      cameras.first,
      ResolutionPreset.high,
      enableAudio: true,
    );
    await _controller!.initialize();
    if (mounted) setState(() {});
  }

  Future<void> _toggleStream() async {
    if (_controller == null) return;

    if (_isStreaming) {
      await _controller!.stopVideoStreaming();
      setState(() => _isStreaming = false);
    } else {
      await _controller!.startVideoStreaming(widget.rtmpUrl);
      setState(() => _isStreaming = true);
    }
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(title: const Text('Live Studio Control')),
      body: Center(
        child: _controller == null || !_controller!.value.isInitialized
            ? const CircularProgressIndicator()
            : CameraPreview(_controller!),
      ),
      floatingActionButton: FloatingActionButton(
        backgroundColor: _isStreaming ? Colors.red : Colors.green,
        onPressed: _toggleStream,
        child: Icon(_isStreaming ? Icons.stop : Icons.play_arrow),
      ),
    );
  }
}
