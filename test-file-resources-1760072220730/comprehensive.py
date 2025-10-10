import os
import sys
from typing import List, Optional, Dict
from dataclasses import dataclass

@dataclass
class UserData:
    id: int
    name: str
    email: str

class DataProcessor:
    def __init__(self, name: str):
        self.name = name
        self._cache: Dict[str, str] = {}

    def process(self, data: List[str]) -> Optional[str]:
        """Process data and return result"""
        if not data:
            return None
        return ", ".join(data)

    def clear_cache(self):
        self._cache.clear()

def create_processor(name: str) -> DataProcessor:
    return DataProcessor(name)

def main():
    processor = create_processor("default")
    result = processor.process(["a", "b", "c"])
    print(result)

if __name__ == "__main__":
    main()