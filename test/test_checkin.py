#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Test suite for checkin.py (PC-driven uiautomator2 flow).

Run with:
    python -m pytest test/test_checkin.py -v
    python -m unittest test.test_checkin -v
    python test/test_checkin.py
"""

import unittest
import sys
import os
import xml.etree.ElementTree as ET

# Add parent dir to import path so we can import checkin
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from checkin import (
    _extract_code,
    _code_from_screen,
    detect_state,
    click_xml_bounds,
    dump_texts,
    APP_PACKAGE,
    T,
)


# ------------------------------------------------------------------
# helpers
# ------------------------------------------------------------------

class MockDevice:
    """Minimal u2 device mock for testing pure-logic functions."""

    def __init__(self, package=APP_PACKAGE, xml="<hierarchy />"):
        self._package = package
        self._xml = xml
        self.clicked = []

    def app_current(self):
        return {"package": self._package}

    def dump_hierarchy(self):
        return self._xml

    def click(self, x, y):
        self.clicked.append((x, y))
        return True


def make_xml(nodes):
    """Build accessibility XML from a list of node specs.

    Each spec is a dict with optional keys: text, content-desc, bounds.
    Uses ET so special chars are properly escaped.
    """
    root = ET.Element("hierarchy")
    for spec in nodes:
        node = ET.SubElement(root, "node")
        for k, v in spec.items():
            node.set(k, str(v))
    return ET.tostring(root, encoding="unicode")


# ------------------------------------------------------------------
# _extract_code tests
# ------------------------------------------------------------------

class TestExtractCode(unittest.TestCase):

    def test_standard_format(self):
        self.assertEqual(_extract_code("\u9a8c\u8bc1\u7801\u4e3a123456"), "123456")

    def test_with_colon(self):
        self.assertEqual(_extract_code("\u9a8c\u8bc1\u7801: 123456"), "123456")

    def test_with_fullwidth_colon(self):
        self.assertEqual(_extract_code("\u9a8c\u8bc1\u7801\uff1a123456"), "123456")

    def test_with_shi(self):
        self.assertEqual(_extract_code("\u9a8c\u8bc1\u7801\u662f123456"), "123456")

    def test_dongtaima(self):
        self.assertEqual(_extract_code("\u52a8\u6001\u7801:123456"), "123456")

    def test_code_not_supported_format(self):
        """"code is X" format not supported - regex only handles whitespace/colon separators."""
        self.assertIsNone(_extract_code("Your code is 123456"))

    def test_code_colon(self):
        self.assertEqual(_extract_code("code:123456"), "123456")

    def test_code_case_insensitive(self):
        self.assertEqual(_extract_code("CODE:123456"), "123456")

    def test_code_with_spaces(self):
        self.assertEqual(_extract_code("code 123456"), "123456")

    def test_min_4_digits(self):
        self.assertEqual(_extract_code("\u9a8c\u8bc1\u7801\u4e3a1234"), "1234")

    def test_max_8_digits(self):
        self.assertEqual(_extract_code("\u9a8c\u8bc1\u7801\u4e3a12345678"), "12345678")

    def test_too_few_digits(self):
        self.assertIsNone(_extract_code("\u9a8c\u8bc1\u7801\u4e3a123"))

    def test_no_keyword(self):
        self.assertIsNone(_extract_code("hello world 123456"))

    def test_empty_string(self):
        self.assertIsNone(_extract_code(""))

    def test_none_input(self):
        self.assertIsNone(_extract_code(None))

    def test_in_long_text(self):
        text = "\u3010\u4e2d\u56fd\u79fb\u52a8\u3011\u60a8\u7684\u9a8c\u8bc1\u7801\u4e3a123456\uff0c\u8bf7\u4e8e5\u5206\u949f\u5185\u4f7f\u7528"
        self.assertEqual(_extract_code(text), "123456")

    def test_multiple_numbers(self):
        text = "\u9a8c\u8bc1\u7801\u4e3a123456\uff0c\u6709\u6548\u671f30\u79d2"
        self.assertEqual(_extract_code(text), "123456")

    def test_code_after_keyword(self):
        text = "\u6709\u6548\u671f30\u79d2\uff0c\u9a8c\u8bc1\u7801\u4e3a123456"
        self.assertEqual(_extract_code(text), "123456")

    def test_real_pushplus_message(self):
        """Simulate a real pushplus notification text."""
        text = "\u3010\u4e2d\u56fd\u79fb\u52a8\u3011\u60a8\u7684\u9a8c\u8bc1\u7801\u4e3a262400\uff0c\u8bf7\u57285\u5206\u949f\u5185\u5b8c\u6210\u9a8c\u8bc1"
        self.assertEqual(_extract_code(text), "262400")


# ------------------------------------------------------------------
# _code_from_screen tests
# ------------------------------------------------------------------

class TestCodeFromScreen(unittest.TestCase):

    def test_code_in_screen(self):
        xml = make_xml([
            {"text": "\u67e5\u770b\u8be6\u60c5"},
            {"text": "\u9a8c\u8bc1\u7801\u4e3a123456"},
        ])
        d = MockDevice(xml=xml)
        self.assertEqual(_code_from_screen(d), "123456")

    def test_no_code_in_screen(self):
        xml = make_xml([
            {"text": "\u67e5\u770b\u8be6\u60c5"},
            {"text": "hello world"},
        ])
        d = MockDevice(xml=xml)
        self.assertIsNone(_code_from_screen(d))

    def test_first_code_wins(self):
        xml = make_xml([
            {"text": "\u9a8c\u8bc1\u7801\u4e3a111111"},
            {"text": "\u9a8c\u8bc1\u7801\u4e3a222222"},
        ])
        d = MockDevice(xml=xml)
        self.assertEqual(_code_from_screen(d), "111111")

    def test_code_in_content_desc(self):
        xml = make_xml([
            {"content-desc": "\u9a8c\u8bc1\u7801\u4e3a999999"},
        ])
        d = MockDevice(xml=xml)
        self.assertEqual(_code_from_screen(d), "999999")


# ------------------------------------------------------------------
# detect_state tests
# ------------------------------------------------------------------

class TestDetectState(unittest.TestCase):

    def test_not_in_app(self):
        d = MockDevice(package="com.other.app", xml="<hierarchy />")
        state, _ = detect_state(d)
        self.assertEqual(state, "not_in_app")

    def test_attendance_page(self):
        xml = make_xml([{"text": T["checkin"]}, {"text": T["attendance"]}])
        d = MockDevice(xml=xml)
        state, _ = detect_state(d)
        self.assertEqual(state, "attendance")

    def test_attendance_page_checkout_only(self):
        """?? button without ?? should also be attendance state."""
        xml = make_xml([{"text": T["checkout"]}, {"text": T["attendance"]}])
        d = MockDevice(xml=xml)
        state, _ = detect_state(d)
        self.assertEqual(state, "attendance")

    def test_attendance_with_both_buttons(self):
        """Both ?? and ?? present should be attendance."""
        xml = make_xml([{"text": T["checkin"]}, {"text": T["checkout"]}])
        d = MockDevice(xml=xml)
        state, _ = detect_state(d)
        self.assertEqual(state, "attendance")

    def test_login_phone_with_getcode(self):
        xml = make_xml([{"text": T["getCode"]}, {"text": T["smsLogin"]}])
        d = MockDevice(xml=xml)
        state, _ = detect_state(d)
        self.assertEqual(state, "login_phone")

    def test_code_countdown(self):
        xml = make_xml([{"text": T["smsLogin"]}, {"text": "59s"}])
        d = MockDevice(xml=xml)
        state, _ = detect_state(d)
        self.assertEqual(state, "code_countdown")

    def test_code_countdown_reget(self):
        xml = make_xml([{"text": T["smsLogin"]}, {"text": "\u91cd\u65b0\u83b7\u53d6"}])
        d = MockDevice(xml=xml)
        state, _ = detect_state(d)
        self.assertEqual(state, "code_countdown")

    def test_code_countdown_refa(self):
        xml = make_xml([{"text": T["smsLogin"]}, {"text": "\u91cd\u53d1"}])
        d = MockDevice(xml=xml)
        state, _ = detect_state(d)
        self.assertEqual(state, "code_countdown")

    def test_login_phone_sms_only(self):
        """smsLogin visible but no getCode (haven't clicked sms login yet)."""
        xml = make_xml([{"text": T["smsLogin"]}])
        d = MockDevice(xml=xml)
        state, _ = detect_state(d)
        self.assertEqual(state, "login_phone")

    def test_workbench(self):
        xml = make_xml([{"text": T["attendance"]}, {"text": T["tabWorkbench"]}])
        d = MockDevice(xml=xml)
        state, _ = detect_state(d)
        self.assertEqual(state, "workbench")

    def test_home(self):
        xml = make_xml([{"text": T["tabWorkbench"]}])
        d = MockDevice(xml=xml)
        state, _ = detect_state(d)
        self.assertEqual(state, "home")

    def test_unknown(self):
        xml = make_xml([{"text": "some random text"}])
        d = MockDevice(xml=xml)
        state, _ = detect_state(d)
        self.assertEqual(state, "unknown")

    def test_attendance_priority_over_workbench(self):
        """If both checkin and attendance texts are present, should be attendance."""
        xml = make_xml([{"text": T["checkin"]}, {"text": T["attendance"]}])
        d = MockDevice(xml=xml)
        state, _ = detect_state(d)
        self.assertEqual(state, "attendance")

    def test_getcode_priority_over_countdown(self):
        """getCode visible means login_phone, even if countdown text also present."""
        xml = make_xml([{"text": T["getCode"]}, {"text": T["smsLogin"]}, {"text": "59s"}])
        d = MockDevice(xml=xml)
        state, _ = detect_state(d)
        self.assertEqual(state, "login_phone")

    def test_notification_texts_no_false_positive(self):
        """Typical notification texts should not cause false state detection."""
        xml = make_xml([
            {"text": "11:15"},
            {"text": "\u7535\u6c60\u72b6\u6001\u9879\u76ee \u5145\u7535\u4e2d, \u5269\u4f59\u7535\u91cf\u767e\u5206\u4e4b85"},
            {"text": "\u7f51\u901f \u72b6\u6001\u680f\u9879\u76ee 948 KB/s"},
            {"text": T["tabWorkbench"]},
        ])
        d = MockDevice(xml=xml)
        state, _ = detect_state(d)
        self.assertEqual(state, "home")

    def test_returns_texts_alongside_state(self):
        xml = make_xml([{"text": T["checkin"]}])
        d = MockDevice(xml=xml)
        state, texts = detect_state(d)
        self.assertEqual(state, "attendance")
        self.assertIn(T["checkin"], texts)


# ------------------------------------------------------------------
# click_xml_bounds tests
# ------------------------------------------------------------------

class TestClickXmlBounds(unittest.TestCase):

    def test_single_match(self):
        xml = make_xml([{"text": T["cancel"], "bounds": "[100,200][300,400]"}])
        d = MockDevice(xml=xml)
        result = click_xml_bounds(d, xml, T["cancel"])
        self.assertTrue(result)
        self.assertEqual(len(d.clicked), 1)
        self.assertEqual(d.clicked[0], (200, 300))

    def test_no_match(self):
        xml = make_xml([{"text": "\u786e\u5b9a", "bounds": "[100,200][300,400]"}])
        d = MockDevice(xml=xml)
        result = click_xml_bounds(d, xml, T["cancel"])
        self.assertFalse(result)
        self.assertEqual(len(d.clicked), 0)

    def test_multiple_matches_first_wins(self):
        xml = make_xml([
            {"text": T["cancel"], "bounds": "[100,200][300,400]"},
            {"text": T["cancel"], "bounds": "[500,600][700,800]"},
        ])
        d = MockDevice(xml=xml)
        result = click_xml_bounds(d, xml, T["cancel"])
        self.assertTrue(result)
        self.assertEqual(len(d.clicked), 1)
        self.assertEqual(d.clicked[0], (200, 300))

    def test_content_desc_match(self):
        xml = make_xml([{"content-desc": T["cancel"], "bounds": "[10,20][30,40]"}])
        d = MockDevice(xml=xml)
        result = click_xml_bounds(d, xml, T["cancel"])
        self.assertTrue(result)
        self.assertEqual(len(d.clicked), 1)
        self.assertEqual(d.clicked[0], (20, 30))

    def test_no_bounds_attr(self):
        xml = make_xml([{"text": T["cancel"]}])
        d = MockDevice(xml=xml)
        result = click_xml_bounds(d, xml, T["cancel"])
        self.assertFalse(result)
        self.assertEqual(len(d.clicked), 0)

    def test_partial_keyword_match(self):
        """Keyword should match text that contains it as a substring."""
        xml = make_xml([{"text": "\u70b9\u51fb" + T["cancel"] + "\u6b64\u64cd\u4f5c", "bounds": "[0,0][100,100]"}])
        d = MockDevice(xml=xml)
        result = click_xml_bounds(d, xml, T["cancel"])
        self.assertTrue(result)
        self.assertEqual(d.clicked[0], (50, 50))

    def test_malformed_bounds(self):
        """Malformed bounds string should not crash, should skip."""
        xml = make_xml([{"text": T["cancel"], "bounds": "invalid"}])
        d = MockDevice(xml=xml)
        result = click_xml_bounds(d, xml, T["cancel"])
        self.assertFalse(result)
        self.assertEqual(len(d.clicked), 0)

    def test_trusted_auth_cancel_button(self):
        """Simulate the trusted auth popup with cancel button."""
        xml = make_xml([
            {"text": T["trustedAuth"]},
            {"text": T["cancel"], "bounds": "[340,1500][540,1600]"},
            {"text": "\u786e\u5b9a", "bounds": "[600,1500][800,1600]"},
        ])
        d = MockDevice(xml=xml)
        result = click_xml_bounds(d, xml, T["cancel"])
        self.assertTrue(result)
        self.assertEqual(d.clicked[0], (440, 1550))


# ------------------------------------------------------------------
# dump_texts tests
# ------------------------------------------------------------------

class TestDumpTexts(unittest.TestCase):

    def test_multiple_texts(self):
        xml = make_xml([{"text": T["checkin"]}, {"text": T["attendance"]}])
        d = MockDevice(xml=xml)
        texts, _ = dump_texts(d)
        self.assertIn(T["checkin"], texts)
        self.assertIn(T["attendance"], texts)

    def test_content_desc(self):
        xml = make_xml([{"content-desc": "\u8fd4\u56de\u6309\u94ae"}])
        d = MockDevice(xml=xml)
        texts, _ = dump_texts(d)
        self.assertIn("\u8fd4\u56de\u6309\u94ae", texts)

    def test_empty_text_filtered(self):
        xml = make_xml([{"text": ""}, {"text": T["checkin"]}, {"text": "   "}])
        d = MockDevice(xml=xml)
        texts, _ = dump_texts(d)
        self.assertEqual(texts, [T["checkin"]])

    def test_nested_nodes(self):
        root = ET.Element("hierarchy")
        parent = ET.SubElement(root, "node")
        parent.set("text", "parent")
        child = ET.SubElement(parent, "node")
        child.set("text", "child")
        xml = ET.tostring(root, encoding="unicode")
        d = MockDevice(xml=xml)
        texts, _ = dump_texts(d)
        self.assertIn("parent", texts)
        self.assertIn("child", texts)

    def test_returns_xml(self):
        xml = make_xml([{"text": T["checkin"]}])
        d = MockDevice(xml=xml)
        _, returned_xml = dump_texts(d)
        self.assertIn(T["checkin"], returned_xml)

    def test_empty_xml(self):
        xml = make_xml([])
        d = MockDevice(xml=xml)
        texts, _ = dump_texts(d)
        self.assertEqual(texts, [])


# ------------------------------------------------------------------
# config consistency tests
# ------------------------------------------------------------------

class TestConfigConsistency(unittest.TestCase):
    """Verify config values match between Python and JS."""

    def test_app_package(self):
        self.assertEqual(APP_PACKAGE, "com.cmri.ercs.yqx")

    def test_phone_input(self):
        from checkin import PHONE_INPUT
        self.assertEqual(PHONE_INPUT, "2449")

    def test_text_keys_complete(self):
        expected_keys = [
            "tabWorkbench", "attendance", "checkin", "checkout",
            "getCode", "codeExpired", "pushplus", "viewDetail",
            "trustedAuth", "cancel",
        ]
        for key in expected_keys:
            self.assertIn(key, T, f"Missing text key: {key}")
            self.assertTrue(T[key], f"Empty text value for: {key}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
