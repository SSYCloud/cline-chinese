#!/usr/bin/env python3
"""
Tests for coverage_check script.
"""

import os
import sys
import unittest
import subprocess
import tempfile
from unittest.mock import patch, MagicMock, call, mock_open

# Add parent directory to path so we can import coverage modules
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from coverage_check import extract_coverage, compare_coverage, set_verbose, generate_comment, post_comment, set_github_output
from coverage_check.util import log, file_exists, get_file_size, list_directory


class TestCoverage(unittest.TestCase):
    # Class variables to store coverage files
    temp_dir = None
    extension_coverage_file = None
    webview_coverage_file = None
    
    @classmethod
    def setUpClass(cls):
        """Set up test environment once for all tests."""
        # Create temporary directory for test files
        cls.temp_dir = tempfile.TemporaryDirectory()
        cls.extension_coverage_file = os.path.join(cls.temp_dir.name, 'extension_coverage.txt')
        cls.webview_coverage_file = os.path.join(cls.temp_dir.name, 'webview_coverage.txt')
        
        # Run actual tests to generate coverage reports
        cls.generate_coverage_reports()
        
        # Verify files exist and are not empty
        assert os.path.exists(cls.extension_coverage_file), \
            f"Extension coverage file {cls.extension_coverage_file} does not exist"
        assert os.path.getsize(cls.extension_coverage_file) > 0, \
            f"Extension coverage file {cls.extension_coverage_file} is empty"
        assert os.path.exists(cls.webview_coverage_file), \
            f"Webview coverage file {cls.webview_coverage_file} does not exist"
        assert os.path.getsize(cls.webview_coverage_file) > 0, \
            f"Webview coverage file {cls.webview_coverage_file} is empty"

    @classmethod
    def tearDownClass(cls):
        """Clean up test environment after all tests."""
        if cls.temp_dir:
            cls.temp_dir.cleanup()

    @classmethod
    def generate_coverage_reports(cls):
        """Generate real coverage reports by running tests."""
        log("Generating coverage reports (this may take a while)...")
        
        # Run extension tests with coverage
        try:
            # Get absolute paths
            root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..'))
            webview_dir = os.path.join(root_dir, 'webview-ui')
            
            # Use xvfb-run on Linux
            if sys.platform.startswith('linux'):
                cmd = f"cd {root_dir} && xvfb-run -a npm run test:coverage > {cls.extension_coverage_file} 2>&1"
            else:
                cmd = f"cd {root_dir} && npm run test:coverage > {cls.extension_coverage_file} 2>&1"
            
            log("Running extension tests...")
            log(f"Command: {cmd}")
            result = subprocess.run(cmd, shell=True, check=False, capture_output=True, text=True)
            log(f"Extension tests exit code: {result.returncode}")
            
            # Run webview tests with coverage
            log("Running webview tests...")
            cmd = f"cd {webview_dir} && npm run test:coverage > {cls.webview_coverage_file} 2>&1"
            log(f"Command: {cmd}")
            result = subprocess.run(cmd, shell=True, check=False, capture_output=True, text=True)
            log(f"Webview tests exit code: {result.returncode}")
            
            # Verify files were created
            if file_exists(cls.extension_coverage_file):
                ext_size = get_file_size(cls.extension_coverage_file)
                log(f"Extension coverage file created: {cls.extension_coverage_file} (size: {ext_size} bytes)")
            else:
                log(f"WARNING: Extension coverage file was not created: {cls.extension_coverage_file}")
                
            if file_exists(cls.webview_coverage_file):
                web_size = get_file_size(cls.webview_coverage_file)
                log(f"Webview coverage file created: {cls.webview_coverage_file} (size: {web_size} bytes)")
            else:
                log(f"WARNING: Webview coverage file was not created: {cls.webview_coverage_file}")
            
            log("Coverage reports generation completed.")
        except Exception as e:
            log(f"Error generating coverage reports: {e}")
            import traceback
            log(traceback.format_exc())
            
            # Create empty files if tests fail
            log("Creating fallback coverage files...")
            with open(cls.extension_coverage_file, 'w') as f:
                f.write("No coverage data available")
            with open(cls.webview_coverage_file, 'w') as f:
                f.write("No coverage data available")

    def test_compare_coverage(self):
        """Test compare_coverage function."""
        # Test with coverage increase
        decreased, diff = compare_coverage(80, 90)
        self.assertFalse(decreased)
        self.assertEqual(diff, 10)
        
        # Test with coverage decrease
        decreased, diff = compare_coverage(90, 80)
        self.assertTrue(decreased)
        self.assertEqual(diff, 10)
        
        # Test with no change
        decreased, diff = compare_coverage(80, 80)
        self.assertFalse(decreased)
        self.assertEqual(diff, 0)

    def test_generate_comment(self):
        """Test generate_comment function."""
        comment = generate_comment(
            80, 90, 'false', 10,
            70, 75, 'false', 5
        )
        
        # Check that comment contains expected sections
        self.assertIn('Coverage Report', comment)
        self.assertIn('Extension Coverage', comment)
        self.assertIn('Webview Coverage', comment)
        self.assertIn('Overall Assessment', comment)
        
        # Check that comment contains coverage percentages
        self.assertIn('Base branch: 80%', comment)
        self.assertIn('PR branch: 90%', comment)
        self.assertIn('Base branch: 70%', comment)
        self.assertIn('PR branch: 75%', comment)
        
        # Check that comment contains correct assessment
        self.assertIn('Coverage increased or remained the same', comment)
        self.assertIn('Test coverage has been maintained or improved', comment)

    def test_set_github_output(self):
        """Test set_github_output function."""
        # Capture stdout
        with patch('sys.stdout', new=MagicMock()) as mock_stdout:
            # Mock environment without GITHUB_OUTPUT
            with patch.dict('os.environ', {}, clear=True):
                set_github_output('test_name', 'test_value')
                
                # Check that the correct output was printed to stdout
                mock_stdout.assert_has_calls([
                    # GitHub Actions output format (deprecated method)
                    call.write('::set-output name=test_name::test_value\n'),
                    call.flush(),
                    # Human readable format
                    call.write('test_name: test_value\n'),
                    call.flush()
                ], any_order=False)
                
                # Reset mock for next test
                mock_stdout.reset_mock()
            
            # Test with GITHUB_OUTPUT environment variable
            with patch.dict('os.environ', {'GITHUB_OUTPUT': '/tmp/github_output'}), \
                 patch('builtins.open', mock_open()) as mock_file:
                set_github_output('test_name', 'test_value')
                
                # Check that file was written to
                mock_file.assert_called_once_with('/tmp/github_output', 'a')
                mock_file().write.assert_called_once_with('test_name=test_value\n')
                
                # Check that human readable output was printed
                mock_stdout.assert_has_calls([
                    call.write('test_name: test_value\n'),
                    call.flush()
                ], any_order=False)


if __name__ == '__main__':
    unittest.main()
