import sys, os, site, platform

# Simulate exactly what skin_inference.py _inject_site_packages() does
venv_site = os.path.join(r'E:\orion_smart-mirror_3\ada_backend', 'venv', 'Lib', 'site-packages')
if os.path.exists(venv_site) and venv_site not in sys.path:
    sys.path.insert(0, venv_site)
    print('Added venv site:', venv_site)

user_site = site.getusersitepackages()
if os.path.exists(user_site) and user_site not in sys.path:
    sys.path.insert(0, user_site)
    print('Added user site:', user_site)

# Check AppData Roaming fallback
if platform.system() == 'Windows':
    appdata = os.environ.get('APPDATA', '')
    py_ver = f'Python{sys.version_info.major}{sys.version_info.minor}'
    roaming = os.path.join(appdata, 'Python', py_ver, 'site-packages')
    if os.path.exists(roaming) and roaming not in sys.path:
        sys.path.insert(0, roaming)
        print('Added roaming site:', roaming)

print()
try:
    import torch
    print('torch:', torch.__version__)
except Exception as e:
    print('torch FAILED:', e)

try:
    import mediapipe as mp
    print('mediapipe:', mp.__version__)
except Exception as e:
    print('mediapipe FAILED:', e)

try:
    import torchvision
    print('torchvision:', torchvision.__version__)
except Exception as e:
    print('torchvision FAILED:', e)

try:
    import cv2
    print('cv2:', cv2.__version__)
except Exception as e:
    print('cv2 FAILED:', e)

print()
print('ALL PACKAGE CHECKS COMPLETE')

