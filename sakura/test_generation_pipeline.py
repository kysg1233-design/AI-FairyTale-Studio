import unittest
from pathlib import Path

from generate_daily_book import ROOT, choose_candidate, extract_story, normalize, parse_model_json, validate_story


class StoryPipelineTests(unittest.TestCase):
    def test_korean_normalization_preserves_syllables(self):
        self.assertEqual(normalize("흥부와 놀부"), normalize("흥부와 놀부"))
        self.assertNotEqual(normalize("흥부와 놀부"), normalize("심청 이야기"))

    def test_candidate_queue_skips_published_book(self):
        candidates = [
            {"title": "흥부와 놀부", "heading": "Hyung Bo and Nahl Bo",
             "source_url": "https://www.gutenberg.org/book/1"},
            {"title": "심청 이야기", "heading": "Sim Chung",
             "source_url": "https://www.gutenberg.org/book/1"}
        ]
        books = [{"title": "흥부와 놀부", "source_title": "Hyung Bo and Nahl Bo",
                  "source_url": "https://www.gutenberg.org/book/1"}]
        selected = list(choose_candidate(candidates, books))
        self.assertEqual(len(selected), 1)
        self.assertEqual(selected[0]["title"], "심청 이야기")

    def test_cached_source_chapter_is_extracted_without_network(self):
        cache = ROOT / ".source-cache"
        cache.mkdir(exist_ok=True)
        path = cache / "gutenberg-987654.source"
        original = path.read_bytes() if path.exists() else None
        try:
            path.write_text(
                "<html><body><h2>THE TESTING FOX</h2>"
                "<p>" + ("A verified public-domain chapter paragraph. " * 20) + "</p>"
                "</body></html>",
                encoding="utf-8",
            )
            candidate = {
                "heading": "THE TESTING FOX",
                "source_url": "https://www.gutenberg.org/cache/epub/987654/pg987654-images.html",
            }
            excerpt = extract_story(candidate)
            self.assertIn("verified public-domain chapter", excerpt)
            self.assertGreater(len(excerpt), 300)
        finally:
            if original is None:
                path.unlink(missing_ok=True)
            else:
                path.write_bytes(original)

    def test_json_parser_extracts_model_object(self):
        parsed = parse_model_json('{"pages": [], "parent_moral": "좋은 마음"}')
        self.assertEqual(parsed["parent_moral"], "좋은 마음")

    def test_story_quality_gate_requires_six_long_korean_pages(self):
        story = {
            "character_bible": "A small red fox with a cream muzzle and green scarf.",
            "parent_moral": "스스로 노력하고 정직하게 행동하는 마음이 중요해요.",
            "pages": [
                {"heading": f"장면 {i}", "text": ("숲속에서 친구들과 함께 용기를 내어 문제를 해결했어요. " * 6),
                 "illustration_prompt": "A fox in a forest, expressive watercolor storybook scene.",
                 "mood": "calm"}
                for i in range(1, 7)
            ]
        }
        validate_story(story)
        story["pages"][0]["text"] = "너무 짧아요."
        with self.assertRaises(ValueError):
            validate_story(story)


if __name__ == "__main__":
    unittest.main()
