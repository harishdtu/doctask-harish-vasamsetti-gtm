import unittest

from growth_machine.targets import generate_batch, SyntheticTarget
from growth_machine.icp import score_target, QUALIFY_THRESHOLD
from growth_machine.enrichment import enrich_target
from growth_machine.persona import map_persona
from growth_machine.personalization import build_personalization
from growth_machine.drafts import generate_draft_sequence, SIMULATION_MARKER
from growth_machine.qa import run_qa


class TestTargetGeneration(unittest.TestCase):
    def test_batch_size(self):
        batch = generate_batch("test_batch", count=10, seed=1)
        self.assertEqual(len(batch), 10)

    def test_synthetic_domains_only(self):
        batch = generate_batch("test_batch", count=20, seed=2)
        for t in batch:
            self.assertTrue(
                any(dom in t.website for dom in ("example.com", "example.org", "example.net", "example.co")),
                f"non-synthetic domain: {t.website}",
            )

    def test_unique_company_names_within_batch(self):
        batch = generate_batch("test_batch", count=20, seed=3)
        names = [t.company_name for t in batch]
        self.assertEqual(len(names), len(set(names)))

    def test_different_seeds_different_batches(self):
        b1 = generate_batch("run_001", count=10)
        b2 = generate_batch("run_002", count=10)
        names1 = {t.company_name for t in b1}
        names2 = {t.company_name for t in b2}
        self.assertNotEqual(names1, names2)

    def test_off_icp_targets_have_no_document_signals(self):
        batch = generate_batch("test_batch", count=30, seed=4)
        off = [t for t in batch if t.is_deliberately_off_icp]
        self.assertTrue(len(off) > 0)
        for t in off:
            self.assertEqual(t.document_signals, [])

    def test_batch_seed_stable_across_processes(self):
        # Regression test: batch seeding must not depend on Python's
        # randomized string hash(), or --batch <id> would produce a
        # different company set on every process invocation.
        import subprocess
        import sys

        script = (
            "from growth_machine.targets import generate_batch; "
            "b = generate_batch('run_001', count=12); "
            "print(','.join(t.company_name for t in b))"
        )
        out_a = subprocess.run(
            [sys.executable, "-c", script],
            capture_output=True, text=True,
            env={"PYTHONHASHSEED": "1", "PATH": "/usr/bin:/bin"},
            cwd=str(__import__("pathlib").Path(__file__).resolve().parent.parent),
        ).stdout.strip()
        out_b = subprocess.run(
            [sys.executable, "-c", script],
            capture_output=True, text=True,
            env={"PYTHONHASHSEED": "42", "PATH": "/usr/bin:/bin"},
            cwd=str(__import__("pathlib").Path(__file__).resolve().parent.parent),
        ).stdout.strip()
        self.assertEqual(out_a, out_b)
        self.assertTrue(out_a)  # sanity: subprocess actually produced output


class TestICPScoring(unittest.TestCase):
    def test_strong_target_qualifies(self):
        t = SyntheticTarget(
            company_name="Testco A",
            website="https://testcoa.example.com",
            company_type="B2B SaaS",
            employee_band="50-200",
            customer_model="B2B",
            implementation_motion="high-touch",
            document_signals=["customer onboarding", "implementation guides", "proposal documents", "rollout playbooks"],
            public_description="desc",
            persona_role="Director of Implementation",
        )
        result = score_target(t)
        self.assertTrue(result.qualified)
        self.assertGreaterEqual(result.score, QUALIFY_THRESHOLD)
        self.assertTrue(len(result.reasons) > 0)

    def test_off_icp_target_disqualifies(self):
        t = SyntheticTarget(
            company_name="Testco B",
            website="https://testcob.example.com",
            company_type="B2B SaaS",
            employee_band="11-50",
            customer_model="B2B",
            implementation_motion="self-serve",
            document_signals=[],
            public_description="desc",
            persona_role="Customer Operations Lead",
            is_deliberately_off_icp=True,
        )
        result = score_target(t)
        self.assertFalse(result.qualified)
        self.assertTrue(len(result.disqualification_reasons) > 0)

    def test_score_never_exceeds_100(self):
        t = SyntheticTarget(
            company_name="Testco C",
            website="https://testcoc.example.com",
            company_type="B2B SaaS",
            employee_band="200-500",
            customer_model="B2B",
            implementation_motion="white-glove",
            document_signals=["a", "b", "c", "d", "e", "f"],
            public_description="desc",
            persona_role="VP Customer Success",
        )
        result = score_target(t)
        self.assertLessEqual(result.score, 100)

    def test_no_fabricated_evidence_when_unknown(self):
        t = SyntheticTarget(
            company_name="Testco D",
            website="https://testcod.example.com",
            company_type="unknown",
            employee_band="Unknown",
            customer_model="B2B",
            implementation_motion="Unknown",
            document_signals=[],
            public_description="Unknown / not observed",
            persona_role="Customer Operations Lead",
        )
        result = score_target(t)
        self.assertIn("Unknown / not observed", result.evidence)


class TestEnrichmentAndPersona(unittest.TestCase):
    def setUp(self):
        self.batch = generate_batch("test_batch", count=10, seed=5)
        self.qualified = [t for t in self.batch if score_target(t).qualified]

    def test_enrichment_records_have_sources(self):
        for t in self.qualified:
            enr = enrich_target(t)
            for rec in enr.records:
                self.assertTrue(rec.source_url)

    def test_persona_never_uses_real_name(self):
        # Persona roles must always come from the fixed role list, never
        # a freeform "name" field.
        from growth_machine.targets import _PERSONA_ROLES
        for t in self.qualified:
            enr = enrich_target(t)
            persona = map_persona(t, enr)
            self.assertIn(persona.likely_buyer_role, _PERSONA_ROLES)

    def test_persona_certainty_is_hedged(self):
        for t in self.qualified:
            enr = enrich_target(t)
            persona = map_persona(t, enr)
            self.assertIn(persona.certainty, {"Likely", "Probable", "Hypothesis", "Unknown"})


class TestDraftsAndQA(unittest.TestCase):
    def setUp(self):
        self.batch = generate_batch("test_batch", count=10, seed=6)
        self.qualified = [t for t in self.batch if score_target(t).qualified]

    def test_every_draft_has_simulation_marker(self):
        for t in self.qualified:
            enr = enrich_target(t)
            persona = map_persona(t, enr)
            chain = build_personalization(t, persona)
            seq = generate_draft_sequence(t, persona, chain)
            for d in (seq.draft_1, seq.draft_2, seq.draft_3):
                self.assertIn(SIMULATION_MARKER, d)

    def test_qa_flags_missing_marker(self):
        for t in self.qualified[:1]:
            enr = enrich_target(t)
            persona = map_persona(t, enr)
            chain = build_personalization(t, persona)
            seq = generate_draft_sequence(t, persona, chain)
            seq.draft_1 = seq.draft_1.replace(SIMULATION_MARKER, "")
            evidence = [r.evidence for r in enr.records]
            qa = run_qa(seq, chain.short_personalized_line, evidence)
            self.assertEqual(qa.safety_status, "FAIL")

    def test_qa_flags_guaranteed_outcome_language(self):
        for t in self.qualified[:1]:
            enr = enrich_target(t)
            persona = map_persona(t, enr)
            chain = build_personalization(t, persona)
            seq = generate_draft_sequence(t, persona, chain)
            seq.draft_1 += " We guarantee results."
            evidence = [r.evidence for r in enr.records]
            qa = run_qa(seq, chain.short_personalized_line, evidence)
            self.assertEqual(qa.safety_status, "FAIL")
            self.assertTrue(any("guaranteed" in i for i in qa.issues))


if __name__ == "__main__":
    unittest.main()
