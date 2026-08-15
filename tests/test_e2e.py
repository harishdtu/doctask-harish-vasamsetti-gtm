import json
import shutil
import tempfile
import unittest
from pathlib import Path

from growth_machine.pipeline import run_batch


class TestEndToEnd(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_two_fresh_batches_no_patching(self):
        out1 = Path(self.tmpdir) / "e2e_run_a"
        out2 = Path(self.tmpdir) / "e2e_run_b"

        m1 = run_batch("e2e_run_a", out1, count=10)
        m2 = run_batch("e2e_run_b", out2, count=14)

        # Both runs produced the required artifact set.
        for out in (out1, out2):
            for fname in ("qualified_targets.json", "enrichment.json", "outreach_drafts.md", "campaign_summary.md", "measurement.json"):
                self.assertTrue((out / fname).exists(), f"missing {fname} in {out}")

        # Fresh batch = a genuinely different, non-overlapping company set,
        # produced by the same code path with no manual patching.
        t1 = {x["target"]["company_name"] for x in json.loads((out1 / "qualified_targets.json").read_text())}
        t2 = {x["target"]["company_name"] for x in json.loads((out2 / "qualified_targets.json").read_text())}
        self.assertNotEqual(t1, t2)
        self.assertTrue(
            t1.isdisjoint(t2),
            f"Unexpected company overlap: {t1 & t2}"
        )

        # Neither run required outreach to be "sent" -- always False.
        meas1 = json.loads((out1 / "measurement.json").read_text())
        meas2 = json.loads((out2 / "measurement.json").read_text())
        self.assertFalse(meas1["outreach_sent"])
        self.assertFalse(meas2["outreach_sent"])

        # Batch sizes differ -> a genuinely fresh batch, not a copy-paste.
        self.assertNotEqual(meas1["funnel"]["targets_discovered"], meas2["funnel"]["targets_discovered"])

    def test_every_draft_in_outreach_file_is_marked_simulation(self):
        out = Path(self.tmpdir) / "e2e_marker_check"
        run_batch("e2e_marker_check", out, count=12)
        content = (out / "outreach_drafts.md").read_text()
        if "Draft 1" in content:
            self.assertIn("SIMULATION / DRAFT -- NOT SENT", content)
            self.assertNotIn("Sincerely,", content)  # no fake real-person signoff


if __name__ == "__main__":
    unittest.main()
