import unittest
from sakura.publish_weekly import parse_json_object

class StoryPlanParserTests(unittest.TestCase):
    def test_plain_json(self):
        self.assertEqual(parse_json_object('{"pages": []}'), {"pages": []})

    def test_markdown_fence(self):
        self.assertEqual(parse_json_object('\\`\\`\\`json\\n{"pages": []}\\n\\`\\`\\`'), {"pages": []})

    def test_surrounding_prose(self):
        self.assertEqual(parse_json_object('Here is JSON:\\n{"pages": []}\\nDone'), {"pages": []})

    def test_truncated_json_rejected(self):
        with self.assertRaises(ValueError):
            parse_json_object('{"pages": [')

if __name__ == "__main__":
    unittest.main()
