"""Put scripts/ on sys.path, the way every pipeline script does for itself."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
