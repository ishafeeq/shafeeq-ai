console.log("Custom JS loaded for debugging (v2)");

// Log all media device changes
navigator.mediaDevices.ondevicechange = (event) => {
    console.log("Media devices changed:", event);
};

// Check available devices
navigator.mediaDevices.enumerateDevices()
    .then(function (devices) {
        devices.forEach(function (device) {
            console.log(device.kind + ": " + device.label + " id = " + device.deviceId);
        });
    })
    .catch(function (err) {
        console.log(err.name + ": " + err.message);
    });

// Hook into getUserMedia
if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async function (constraints) {
        console.log("Requesting microphone access with constraints:", constraints);
        try {
            const stream = await originalGetUserMedia(constraints);
            console.log("Microphone access granted:", stream);
            return stream;
        } catch (error) {
            console.error("Microphone access denied or error:", error);
            throw error;
        }
    };
}
