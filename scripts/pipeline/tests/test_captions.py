import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]

def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

caption = load('caption', 'whisper-caption.py')
karaoke = load('karaoke', 'vtt-to-karaoke.py')

class CaptionsTest(unittest.TestCase):
    def test_millisecond_rounding(self):
        self.assertEqual(caption.fmt(59.9999), '00:01:00.000')

    def test_no_empty_words(self):
        with self.assertRaises(ValueError):
            caption.build_vtt([], 1)

    def test_out_of_bounds(self):
        with self.assertRaises(ValueError):
            caption.build_vtt([dict(word='আজ', start=0, end=3)], 1)

    def test_no_index_interpolation(self):
        words = [dict(word='আজ', start=.1, end=.4), dict(word='সংবাদ', start=.4, end=.9)]
        text = caption.build_vtt(words, 1)
        self.assertIn('00:00:00.400 --> 00:00:00.900\nসংবাদ', text)

    def test_short_word_not_extended(self):
        ass = karaoke.convert('WEBVTT\n\n00:00:00.100 --> 00:00:00.150\nআজ\n\n')
        self.assertIn('0:00:00.10,0:00:00.15', ass)
        self.assertIn('\\kf5', ass)

    def test_pause_retained(self):
        ass = karaoke.convert('WEBVTT\n\n00:00:00.100 --> 00:00:00.300\nআজ\n\n00:00:00.500 --> 00:00:00.800\nসংবাদ\n\n')
        self.assertIn('\\k20', ass)

    def test_blank_ass_rejected(self):
        with self.assertRaises(ValueError):
            karaoke.convert('WEBVTT\n\n')

if __name__ == '__main__':
    unittest.main()
