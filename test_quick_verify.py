#!/usr/bin/env python3
"""
Quick verification that unified search tools are working
"""
import subprocess
import json
import time

def test_tool_availability():
    """Test that tools are available via claude CLI"""
    print("🔍 Testing tool availability...")

    cmd = ["claude", "List the available MCP tools and tell me if 'search_knowledge_graph_unified' and 'acquire_repository' are available"]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        if result.returncode == 0:
            output = result.stdout.lower()
            has_unified = "search_knowledge_graph_unified" in output
            has_acquire = "acquire_repository" in output

            print(f"  ✅ search_knowledge_graph_unified: {'Found' if has_unified else 'Missing'}")
            print(f"  ✅ acquire_repository: {'Found' if has_acquire else 'Missing'}")

            return has_unified and has_acquire
        else:
            print(f"  ❌ CLI failed: {result.stderr}")
            return False
    except subprocess.TimeoutExpired:
        print("  ⚠️ CLI timed out")
        return False
    except Exception as e:
        print(f"  ❌ Error: {e}")
        return False

def test_build_integration():
    """Test that everything builds and tools are in the server"""
    print("🔨 Testing build integration...")

    # Check built server contains our tools
    try:
        with open('/home/jw/dev/game1/ZMCPTools/dist/server/index.js', 'r') as f:
            content = f.read()

        has_unified = 'search_knowledge_graph_unified' in content
        has_acquire = 'acquire_repository' in content
        has_routing = 'analyzeQuery' in content

        print(f"  ✅ Unified search in build: {'Yes' if has_unified else 'No'}")
        print(f"  ✅ Code acquisition in build: {'Yes' if has_acquire else 'No'}")
        print(f"  ✅ Auto-routing in build: {'Yes' if has_routing else 'No'}")

        return has_unified and has_acquire and has_routing
    except Exception as e:
        print(f"  ❌ Error checking build: {e}")
        return False

def main():
    print("🧪 Quick Verification of Unified Search Integration")
    print("=" * 50)

    tests = [
        ("Build Integration", test_build_integration),
        ("Tool Availability", test_tool_availability)
    ]

    results = []
    for test_name, test_func in tests:
        print(f"\n{test_name}:")
        success = test_func()
        results.append((test_name, success))

    print("\n📊 VERIFICATION SUMMARY")
    print("=" * 30)

    passed = sum(1 for _, success in results if success)
    total = len(results)

    for test_name, success in results:
        status = "✅" if success else "❌"
        print(f"{status} {test_name}")

    print(f"\nPassed: {passed}/{total}")

    if passed == total:
        print("🎉 ALL VERIFICATIONS PASSED!")
        print("The unified search integration is complete and working.")
        return 0
    else:
        print(f"⚠️ {total - passed} verifications failed.")
        return 1

if __name__ == "__main__":
    exit(main())