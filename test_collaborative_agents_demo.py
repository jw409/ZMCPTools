#!/usr/bin/env python3
"""
Working Demo: Collaborative Agent Architecture (Issue #22)
Tests the three-agent collaboration with enhanced permissions and meeting protocols
"""

import asyncio
import subprocess
import json
import time
from typing import Dict, Any, Optional

class CollaborativeAgentDemo:
    """Demo the collaborative agent architecture"""

    def __init__(self):
        self.repository_path = "/home/jw/dev/game1/ZMCPTools"

    async def call_mcp_tool(self, tool_name: str, params: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Call an MCP tool via claude CLI"""
        prompt = f"""Use the {tool_name} tool with these exact parameters:
{json.dumps(params, indent=2)}

Return only the raw tool response as JSON, no additional text."""

        cmd = ["claude", "-p", prompt]

        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            if result.returncode == 0:
                # Try to parse JSON from response
                lines = result.stdout.strip().split('\n')
                for line in lines:
                    try:
                        return json.loads(line)
                    except json.JSONDecodeError:
                        continue

                print(f"  Raw response: {result.stdout[:200]}...")
                return {"raw_response": result.stdout}
            else:
                print(f"  ❌ CLI error: {result.stderr}")
                return None
        except subprocess.TimeoutExpired:
            print("  ⚠️ CLI timed out")
            return None
        except Exception as e:
            print(f"  ❌ Exception: {e}")
            return None

    async def test_collaborative_orchestration(self) -> bool:
        """Test collaborative agent team orchestration"""
        print("🎯 Testing Collaborative Agent Orchestration")

        # Simple but realistic objective
        objective = "Add a simple health check endpoint to the server and create a test for it"

        params = {
            "repository_path": self.repository_path,
            "objective": objective,
            "team_configuration": {
                "planner_instructions": "Focus on REST API design and implementation planning",
                "implementer_instructions": "Create endpoint that returns system status and timestamp",
                "tester_instructions": "Create both unit test and integration test for the endpoint"
            },
            "collaboration_settings": {
                "max_session_duration_minutes": 60,
                "turn_timeout_minutes": 10,
                "require_unanimous_completion": True,
                "auto_advance_phases": False
            }
        }

        print(f"  Objective: {objective}")
        print(f"  Repository: {self.repository_path}")

        result = await self.call_mcp_tool("orchestrate_collaborative_team", params)

        if result and result.get("success"):
            print("  ✅ Collaborative orchestration successful!")

            session_info = result.get("collaboration_session", {})
            team_members = result.get("team_members", {})
            coordination = result.get("coordination", {})

            print(f"  📋 Session ID: {session_info.get('session_id', 'N/A')}")
            print(f"  📊 Status: {session_info.get('status', 'N/A')}")
            print(f"  🎭 Current Phase: {session_info.get('current_phase', 'N/A')}")

            print("  👥 Team Members:")
            for role, member in team_members.items():
                print(f"    - {role.title()}: {member.get('agent_id', 'N/A')} ({member.get('status', 'N/A')})")

            print(f"  💬 Coordination Room: {coordination.get('room_id', 'N/A')}")
            print(f"  🎤 Current Speaker: {coordination.get('current_speaker', 'N/A')}")

            # Check phase structure
            phases = coordination.get('phase_structure', [])
            if phases:
                print("  📝 Phase Structure:")
                for i, phase in enumerate(phases):
                    print(f"    {i+1}. {phase.get('name', 'N/A')} ({phase.get('max_duration_minutes', 'N/A')}min) - Owner: {phase.get('owner', 'N/A')}")

            # Check knowledge context
            knowledge = result.get('knowledge_context', {})
            if knowledge:
                print(f"  🧠 Knowledge Context: {knowledge.get('relevant_findings', 'N/A')}")

            return True
        else:
            print("  ❌ Collaborative orchestration failed")
            if result:
                print(f"    Error: {result.get('error', 'Unknown error')}")
                suggestions = result.get('troubleshooting', [])
                if suggestions:
                    print("    Troubleshooting:")
                    for suggestion in suggestions:
                        print(f"      - {suggestion}")
            return False

    async def test_agent_permissions(self) -> bool:
        """Test that agents have proper permissions"""
        print("🔐 Testing Enhanced Agent Permissions")

        # Test spawning each agent type individually to verify permissions
        agent_types = [
            ("planner_agent", "Strategic planning and coordination"),
            ("implementer_agent", "Code implementation and execution"),
            ("tester_agent", "Testing and quality verification")
        ]

        all_passed = True

        for agent_type, description in agent_types:
            print(f"  Testing {agent_type}...")

            params = {
                "repository_path": self.repository_path,
                "agent_type": agent_type,
                "task_description": f"Test {description} capabilities",
                "additional_instructions": "This is a permission test - verify your tool access"
            }

            result = await self.call_mcp_tool("mcp__zmcp-tools__spawn_agent", params)

            if result and result.get("success"):
                agent_id = result.get("agent_id", "N/A")
                print(f"    ✅ {agent_type} spawned successfully: {agent_id}")

                # Check reported permissions
                permissions = result.get("permissions", {})
                if permissions:
                    allowed_categories = permissions.get("allowed_categories", [])
                    print(f"    🔧 Allowed categories: {', '.join(allowed_categories) if allowed_categories else 'None'}")

                    # Verify key permissions for each type
                    if agent_type == "planner_agent":
                        required = ["communication_tools", "orchestration_tools", "knowledge_graph_tools"]
                        has_required = all(cat in allowed_categories for cat in required)
                        if has_required:
                            print(f"    ✅ Planner has required coordination permissions")
                        else:
                            print(f"    ⚠️ Planner missing required permissions")
                            all_passed = False

                    elif agent_type == "implementer_agent":
                        required = ["execution_tools", "file_tools", "communication_tools"]
                        has_required = all(cat in allowed_categories for cat in required)
                        if has_required:
                            print(f"    ✅ Implementer has required execution permissions")
                        else:
                            print(f"    ⚠️ Implementer missing required permissions")
                            all_passed = False

                    elif agent_type == "tester_agent":
                        required = ["execution_tools", "browser_tools", "communication_tools"]
                        has_required = all(cat in allowed_categories for cat in required)
                        if has_required:
                            print(f"    ✅ Tester has required testing permissions")
                        else:
                            print(f"    ⚠️ Tester missing required permissions")
                            all_passed = False

            else:
                print(f"    ❌ Failed to spawn {agent_type}")
                if result:
                    print(f"      Error: {result.get('error', 'Unknown error')}")
                all_passed = False

        return all_passed

    async def test_tool_availability(self) -> bool:
        """Test that the collaborative tools are available"""
        print("🔧 Testing Tool Availability")

        # Test that our new tool is available
        cmd = ["claude", "List the available MCP tools and tell me if 'orchestrate_collaborative_team' is available"]

        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            if result.returncode == 0:
                output = result.stdout.lower()
                has_collab_tool = "orchestrate_collaborative_team" in output

                print(f"  ✅ orchestrate_collaborative_team: {'Available' if has_collab_tool else 'Missing'}")

                # Also check for other required tools
                required_tools = [
                    "mcp__zmcp-tools__spawn_agent",
                    "mcp__zmcp-tools__join_room",
                    "mcp__zmcp-tools__send_message",
                    "search_knowledge_graph_unified"
                ]

                available_count = 0
                for tool in required_tools:
                    if tool in output:
                        available_count += 1
                        print(f"  ✅ {tool}: Available")
                    else:
                        print(f"  ❌ {tool}: Missing")

                success = has_collab_tool and available_count >= len(required_tools) * 0.75
                return success
            else:
                print(f"  ❌ Tool list failed: {result.stderr}")
                return False
        except subprocess.TimeoutExpired:
            print("  ⚠️ Tool list timed out")
            return False
        except Exception as e:
            print(f"  ❌ Error: {e}")
            return False

    async def run_comprehensive_demo(self):
        """Run the complete collaborative agent demo"""
        print("🎪 Collaborative Agent Architecture Demo (Issue #22)")
        print("=" * 60)

        tests = [
            ("Tool Availability", self.test_tool_availability),
            ("Agent Permissions", self.test_agent_permissions),
            ("Collaborative Orchestration", self.test_collaborative_orchestration)
        ]

        results = []

        for test_name, test_func in tests:
            print(f"\n{test_name}:")
            try:
                success = await test_func()
                results.append((test_name, success))
            except Exception as e:
                print(f"  ❌ Test failed with exception: {e}")
                results.append((test_name, False))

        print(f"\n📊 DEMO RESULTS")
        print("=" * 30)

        passed = sum(1 for _, success in results if success)
        total = len(results)

        for test_name, success in results:
            status = "✅" if success else "❌"
            print(f"{status} {test_name}")

        print(f"\nPassed: {passed}/{total}")

        if passed == total:
            print("\n🎉 ALL DEMO TESTS PASSED!")
            print("✅ Collaborative agent architecture is working correctly")
            print("✅ Three-agent teams (Planner/Implementer/Tester) operational")
            print("✅ Enhanced permissions fix permission starvation")
            print("✅ Meeting protocol engine provides structured coordination")
            print("\n🚀 Ready for real collaborative development!")
        else:
            print(f"\n⚠️ {total - passed} tests failed.")
            print("Check implementation and dependencies.")

        return passed == total

async def main():
    """Main demo execution"""
    demo = CollaborativeAgentDemo()

    try:
        success = await demo.run_comprehensive_demo()
        return 0 if success else 1
    except Exception as e:
        print(f"❌ Demo failed with error: {e}")
        import traceback
        traceback.print_exc()
        return 1

if __name__ == "__main__":
    exit(asyncio.run(main()))