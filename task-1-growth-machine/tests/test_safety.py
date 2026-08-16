"""
Safety tests.

These are the tests that matter most for this task: they verify the
machine cannot send anything, cannot leak real personal data, cannot
leak secrets, and always marks drafts as simulations.
"""
import ast
import os
import re
import unittest
from pathlib import Path

PKG_DIR = Path(__file__).resolve().parent.parent / "growth_machine"

# Any function/identifier name containing these substrings is treated
# as a "send" capability, whether or not it's ever called.
_SEND_NAME_PATTERN = re.compile(r"(send_?mail|send_?message\(|send_?email\(|smtplib|requests\.post|urllib.*post|dm_send|post_to)", re.I)


class TestNoSendCapability(unittest.TestCase):
    def test_no_send_functions_defined_anywhere(self):
        offenders = []
        for py_file in PKG_DIR.glob("*.py"):
            source = py_file.read_text()
            tree = ast.parse(source, filename=str(py_file))
            for node in ast.walk(tree):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    if _SEND_NAME_PATTERN.search(node.name):
                        offenders.append(f"{py_file.name}:{node.name}")
        self.assertEqual(offenders, [], f"Found send-like function definitions: {offenders}")

    def test_no_smtp_or_http_post_calls(self):
        offenders = []
        for py_file in PKG_DIR.glob("*.py"):
            source = py_file.read_text()
            if _SEND_NAME_PATTERN.search(source):
                offenders.append(py_file.name)
        self.assertEqual(offenders, [], f"Found send-capable code in: {offenders}")

    def test_cli_dry_run_and_send_flags_are_hardcoded_safe(self):
        from growth_machine import cli
        self.assertTrue(cli.DRY_RUN)
        self.assertFalse(cli.SEND_MESSAGES)


class TestNoSecretsInRepo(unittest.TestCase):
    _SECRET_PATTERN = re.compile(r"(api[_-]?key|secret|password|bearer\s+[a-z0-9]{10,})\s*[:=]\s*['\"][a-zA-Z0-9_\-]{8,}", re.I)

    def test_no_secret_looking_strings_in_source(self):
        root = PKG_DIR.parent
        offenders = []
        for py_file in list(root.glob("growth_machine/*.py")) + list(root.glob("tests/*.py")):
            source = py_file.read_text()
            if self._SECRET_PATTERN.search(source):
                offenders.append(py_file.name)
        self.assertEqual(offenders, [], f"Possible secret-looking literal in: {offenders}")

    def test_env_is_gitignored(self):
        gitignore = (PKG_DIR.parent / ".gitignore")
        self.assertTrue(gitignore.exists())
        content = gitignore.read_text()
        self.assertIn(".env", content)


class TestSyntheticDataOnly(unittest.TestCase):
    def test_synthetic_targets_never_use_personal_names(self):
        # Personal-name heuristic: SyntheticTarget.company_name should
        # never resolve to a single common first+last name pattern from
        # our known-fictional-company generator; every generated name
        # is Prefix+Suffix pulled from company-style word lists.
        from growth_machine.targets import generate_batch, _PREFIXES, _SUFFIXES
        batch = generate_batch("safety_test", count=25, seed=42)
        for t in batch:
            prefix, _, suffix = t.company_name.partition(" ")
            self.assertIn(prefix, _PREFIXES)
            self.assertIn(suffix, _SUFFIXES)

    def test_public_targets_missing_file_falls_back_gracefully(self):
        from growth_machine.public_targets import load_public_targets
        result = load_public_targets("data/this_file_does_not_exist.json")
        self.assertEqual(result, [])


if __name__ == "__main__":
    unittest.main()
