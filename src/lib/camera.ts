export interface PreferredCameraResult {
  stream: MediaStream;
  activeDevice: MediaDeviceInfo | null;
  availableDevices: MediaDeviceInfo[];
}

const INTEGRATED_CAMERA_PATTERN =
  /\b(integrated|internal|built[\s-]?in|inbuilt|facetime|front\s*camera|ir\s*camera|windows\s*hello)\b|0bda:5538/i;

const VIRTUAL_CAMERA_PATTERN =
  /\b(virtual|obs|snap\s*camera|manycam|xsplit|droidcam|iriun|camo)\b/i;

const EXTERNAL_USB_CAMERA_PATTERN =
  /\b(usb\s*video|usb\s*camera|usb\s*webcam|usb|external|logi|logitech|c270|c310|c505|c615|c920|c922|c930|brio|streamcam|lifecam|razer|kiyo|elgato|facecam|anker|powerconf|creative|ausdom|nexigo|emeet|papalook|uvc|hd\s*webcam)\b|046d:/i;

/**
 * Scores a videoinput device so that connected external USB webcams
 * are always prioritized over laptop inbuilt/integrated cameras.
 */
export function scoreCameraDevice(device: MediaDeviceInfo, index: number, _total: number): number {
  const label = (device.label || '').trim();

  if (!label) {
    return 50 - index;
  }

  let score = 50;

  if (VIRTUAL_CAMERA_PATTERN.test(label)) {
    score -= 80;
  }

  const isIntegrated = INTEGRATED_CAMERA_PATTERN.test(label);
  const isExternalUsb = EXTERNAL_USB_CAMERA_PATTERN.test(label);

  if (isIntegrated) {
    // Laptop inbuilt camera: deprioritize so external USB webcam wins
    score -= 60;
  } else {
    // Non-integrated physical camera
    score += 40;
  }

  if (isExternalUsb && !isIntegrated) {
    score += 60;
  }

  return score;
}

/**
 * Picks the best external USB webcam from the list of videoinput devices,
 * falling back to the inbuilt camera only if no external webcam is connected.
 */
export function selectPreferredWebcam(devices: MediaDeviceInfo[], preferredDeviceId?: string): MediaDeviceInfo | null {
  const videoInputs = devices.filter(d => d.kind === 'videoinput');
  if (videoInputs.length === 0) return null;

  if (preferredDeviceId) {
    const exactMatch = videoInputs.find(d => d.deviceId === preferredDeviceId);
    if (exactMatch) return exactMatch;
  }

  const scored = videoInputs.map((device, index) => ({
    device,
    score: scoreCameraDevice(device, index, videoInputs.length),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored[0].device;
}

/**
 * Opens a MediaStream prioritizing the connected external USB webcam over the laptop's inbuilt camera.
 */
export async function getPreferredWebcamStream(
  extraConstraints: MediaTrackConstraints = {},
  preferredDeviceId?: string
): Promise<PreferredCameraResult> {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('Camera API (navigator.mediaDevices.getUserMedia) is not available.');
  }

  let allDevices = await navigator.mediaDevices.enumerateDevices();
  let videoInputs = allDevices.filter(d => d.kind === 'videoinput');

  // If device labels are blank (permissions not yet unlocked in this browser session),
  // briefly open a temporary video stream to unlock full hardware device labels.
  const hasLabels = videoInputs.some(d => d.label && d.label.trim().length > 0);
  if (!hasLabels && videoInputs.length > 0) {
    try {
      const tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      tempStream.getTracks().forEach(t => t.stop());
      allDevices = await navigator.mediaDevices.enumerateDevices();
      videoInputs = allDevices.filter(d => d.kind === 'videoinput');
    } catch {
      // Ignore and proceed with available device entries
    }
  }

  // Order candidate devices from highest score (external USB webcam) to lowest (inbuilt camera)
  const orderedCandidates = [...videoInputs].sort(
    (a, b) =>
      scoreCameraDevice(b, videoInputs.indexOf(b), videoInputs.length) -
      scoreCameraDevice(a, videoInputs.indexOf(a), videoInputs.length)
  );

  if (preferredDeviceId) {
    const chosenIdx = orderedCandidates.findIndex(d => d.deviceId === preferredDeviceId);
    if (chosenIdx > 0) {
      const [chosen] = orderedCandidates.splice(chosenIdx, 1);
      orderedCandidates.unshift(chosen);
    }
  }

  // Try opening candidates in priority order (external USB webcam first)
  for (const candidate of orderedCandidates) {
    if (!candidate.deviceId) continue;

    // 1. Try with ideal HD resolution on the exact USB device
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          ...extraConstraints,
          deviceId: { exact: candidate.deviceId },
          width: extraConstraints.width ?? { ideal: 1280 },
          height: extraConstraints.height ?? { ideal: 720 },
        },
        audio: false,
      });
      console.log(`[Camera] Using video device: "${candidate.label || candidate.deviceId}"`);
      return { stream, activeDevice: candidate, availableDevices: videoInputs };
    } catch (err) {
      console.warn(`[Camera] HD constraints failed for "${candidate.label || candidate.deviceId}", retrying default resolution…`, err);
    }

    // 2. Retry with minimal constraints on the exact USB device (in case 1280x720 isn't supported)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: candidate.deviceId },
        },
        audio: false,
      });
      console.log(`[Camera] Using video device (default resolution): "${candidate.label || candidate.deviceId}"`);
      return { stream, activeDevice: candidate, availableDevices: videoInputs };
    } catch (err) {
      console.warn(`[Camera] Could not open device "${candidate.label || candidate.deviceId}":`, err);
    }
  }

  // Final fallback if deviceId enumeration wasn't possible
  const fallbackStream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      ...extraConstraints,
    },
    audio: false,
  });

  return {
    stream: fallbackStream,
    activeDevice: orderedCandidates[0] ?? null,
    availableDevices: videoInputs,
  };
}
