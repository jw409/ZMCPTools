"""Process monitoring utilities for testing agent lifecycle."""

import os
import signal
import time
from typing import Dict, List, Optional, Set

import psutil


class ProcessMonitor:
    """Monitor processes during agent testing to identify defunct/zombie processes."""
    
    def __init__(self, root_pid: Optional[int] = None):
        self.root_pid = root_pid or os.getpid()
        self.initial_processes: Set[int] = set()
        self.tracked_processes: Dict[int, Dict] = {}
        
    def start_monitoring(self) -> None:
        """Start monitoring by recording the initial process state."""
        self.initial_processes = self._get_current_pids()
        print(f"ProcessMonitor: Started monitoring with {len(self.initial_processes)} initial processes")
        
    def track_process(self, pid: int, description: str = "") -> None:
        """Track a specific process for monitoring."""
        try:
            process = psutil.Process(pid)
            self.tracked_processes[pid] = {
                "description": description,
                "start_time": time.time(),
                "initial_status": process.status(),
                "cmdline": " ".join(process.cmdline()) if process.cmdline() else process.name(),
                "ppid": process.ppid(),
            }
            print(f"ProcessMonitor: Now tracking PID {pid} ({description})")
        except psutil.NoSuchProcess:
            print(f"ProcessMonitor: Cannot track PID {pid} - process does not exist")
    
    def check_for_defunct(self) -> List[Dict]:
        """Check for defunct/zombie processes in the process tree."""
        current_processes = self._get_process_tree()
        defunct_processes = []
        
        for proc_info in current_processes:
            if proc_info.get("status") == "zombie":
                defunct_processes.append(proc_info)
                
        return defunct_processes
    
    def check_tracked_processes(self) -> Dict[int, Dict]:
        """Check the status of all tracked processes."""
        status_report = {}
        
        for pid, info in self.tracked_processes.items():
            try:
                process = psutil.Process(pid)
                current_status = process.status()
                runtime = time.time() - info["start_time"]
                
                status_report[pid] = {
                    "description": info["description"],
                    "initial_status": info["initial_status"],
                    "current_status": current_status,
                    "runtime_seconds": runtime,
                    "is_running": process.is_running(),
                    "cmdline": info["cmdline"],
                    "ppid": info["ppid"],
                }
                
                if current_status == "zombie":
                    print(f"WARNING: Tracked process {pid} ({info['description']}) is now ZOMBIE")
                    
            except psutil.NoSuchProcess:
                status_report[pid] = {
                    "description": info["description"],
                    "initial_status": info["initial_status"],
                    "current_status": "not_found",
                    "runtime_seconds": time.time() - info["start_time"],
                    "is_running": False,
                    "cmdline": info["cmdline"],
                    "ppid": info["ppid"],
                }
                
        return status_report
    
    def get_new_processes(self) -> List[Dict]:
        """Get processes that were created since monitoring started."""
        current_pids = self._get_current_pids()
        new_pids = current_pids - self.initial_processes
        
        new_processes = []
        for pid in new_pids:
            try:
                process = psutil.Process(pid)
                proc_info = {
                    "pid": pid,
                    "name": process.name(),
                    "status": process.status(),
                    "cmdline": " ".join(process.cmdline()) if process.cmdline() else process.name(),
                    "ppid": process.ppid(),
                    "create_time": process.create_time(),
                }
                new_processes.append(proc_info)
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                continue
                
        return new_processes
    
    def cleanup_defunct_processes(self) -> int:
        """Attempt to clean up defunct processes by signaling their parents."""
        defunct_processes = self.check_for_defunct()
        cleaned_count = 0
        
        for proc_info in defunct_processes:
            pid = proc_info["pid"]
            ppid = proc_info["ppid"]
            
            print(f"ProcessMonitor: Attempting to clean defunct process {pid} (parent: {ppid})")
            
            try:
                # Send SIGCHLD to parent to encourage it to reap the zombie
                os.kill(ppid, signal.SIGCHLD)
                time.sleep(0.1)  # Brief pause for signal processing
                
                # Check if the process is still defunct
                try:
                    process = psutil.Process(pid)
                    if process.status() != "zombie":
                        cleaned_count += 1
                        print(f"ProcessMonitor: Successfully cleaned up defunct process {pid}")
                except psutil.NoSuchProcess:
                    # Process no longer exists - considered cleaned up
                    cleaned_count += 1
                    print(f"ProcessMonitor: Defunct process {pid} no longer exists")
                    
            except (ProcessLookupError, PermissionError) as e:
                print(f"ProcessMonitor: Cannot signal parent {ppid} for defunct process {pid}: {e}")
            except Exception as e:
                print(f"ProcessMonitor: Unexpected error cleaning defunct process {pid}: {e}")
                
        return cleaned_count
    
    def generate_report(self) -> Dict:
        """Generate a comprehensive monitoring report."""
        current_processes = self._get_process_tree()
        defunct_processes = self.check_for_defunct()
        new_processes = self.get_new_processes()
        tracked_status = self.check_tracked_processes()
        
        report = {
            "timestamp": time.time(),
            "root_pid": self.root_pid,
            "total_processes": len(current_processes),
            "initial_process_count": len(self.initial_processes),
            "new_process_count": len(new_processes),
            "defunct_process_count": len(defunct_processes),
            "tracked_process_count": len(self.tracked_processes),
            "defunct_processes": defunct_processes,
            "new_processes": new_processes,
            "tracked_processes": tracked_status,
        }
        
        return report
    
    def print_report(self) -> None:
        """Print a human-readable monitoring report."""
        report = self.generate_report()
        
        print(f"\n=== ProcessMonitor Report ===")
        print(f"Root PID: {report['root_pid']}")
        print(f"Total processes: {report['total_processes']}")
        print(f"Initial processes: {report['initial_process_count']}")
        print(f"New processes: {report['new_process_count']}")
        print(f"Defunct processes: {report['defunct_process_count']}")
        print(f"Tracked processes: {report['tracked_process_count']}")
        
        if report["defunct_processes"]:
            print(f"\nDEFUNCT PROCESSES:")
            for proc in report["defunct_processes"]:
                print(f"  PID {proc['pid']}: {proc['cmdline']} (parent: {proc['ppid']})")
        
        if report["tracked_processes"]:
            print(f"\nTRACKED PROCESSES:")
            for pid, status in report["tracked_processes"].items():
                print(f"  PID {pid} ({status['description']}): {status['current_status']} (runtime: {status['runtime_seconds']:.1f}s)")
        
        print(f"=== End Report ===\n")
    
    def _get_current_pids(self) -> Set[int]:
        """Get all current process IDs in the tree."""
        current_pids = set()
        
        try:
            root_process = psutil.Process(self.root_pid)
            all_processes = [root_process] + root_process.children(recursive=True)
            
            for proc in all_processes:
                current_pids.add(proc.pid)
                
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
            
        return current_pids
    
    def _get_process_tree(self) -> List[Dict]:
        """Get detailed information about all processes in the tree."""
        processes = []
        
        try:
            root_process = psutil.Process(self.root_pid)
            all_processes = [root_process] + root_process.children(recursive=True)
            
            for proc in all_processes:
                try:
                    proc_info = {
                        "pid": proc.pid,
                        "ppid": proc.ppid(),
                        "name": proc.name(),
                        "status": proc.status(),
                        "cmdline": " ".join(proc.cmdline()) if proc.cmdline() else proc.name(),
                        "create_time": proc.create_time(),
                        "memory_info": proc.memory_info()._asdict() if proc.is_running() else None,
                    }
                    processes.append(proc_info)
                except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                    # Process may have disappeared or be inaccessible
                    continue
                    
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
            
        return processes


def find_claude_processes() -> List[Dict]:
    """Find all running Claude CLI processes on the system."""
    claude_processes = []
    
    for proc in psutil.process_iter(['pid', 'name', 'cmdline', 'status', 'ppid']):
        try:
            cmdline = proc.info['cmdline']
            if cmdline and any('claude' in arg.lower() for arg in cmdline):
                claude_processes.append({
                    "pid": proc.info['pid'],
                    "name": proc.info['name'],
                    "cmdline": " ".join(cmdline),
                    "status": proc.info['status'],
                    "ppid": proc.info['ppid'],
                })
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue
            
    return claude_processes


def kill_orphaned_claude_processes() -> int:
    """Kill any orphaned Claude processes that might be causing issues."""
    claude_processes = find_claude_processes()
    killed_count = 0
    
    for proc_info in claude_processes:
        pid = proc_info["pid"]
        
        try:
            process = psutil.Process(pid)
            
            # Only kill if it looks like a test process
            if "test" in proc_info["cmdline"].lower() or proc_info["status"] == "zombie":
                print(f"Killing orphaned Claude process {pid}: {proc_info['cmdline']}")
                process.terminate()
                
                # Wait a moment, then force kill if necessary
                time.sleep(1)
                if process.is_running():
                    process.kill()
                
                killed_count += 1
                
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
            
    return killed_count