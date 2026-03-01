export class WavRecorder {
    private mediaStream: MediaStream | null = null;
    private mediaRecorder: MediaRecorder | null = null;
    private chunks: Blob[] = [];

    private startTime: number = 0;

    async start(): Promise<MediaStream | null> {
        this.chunks = [];
        this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

        const options = { mimeType: 'audio/webm' };
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            // Fallback if webm is not supported (e.g. older Safari)
            this.mediaRecorder = new MediaRecorder(this.mediaStream);
        } else {
            this.mediaRecorder = new MediaRecorder(this.mediaStream, options);
        }

        this.mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
                this.chunks.push(e.data);
            }
        };

        this.mediaRecorder.start();
        this.startTime = Date.now();
        return this.mediaStream;
    }

    /** Returns the active MediaStream (for external AnalyserNode attachment) */
    getStream(): MediaStream | null {
        return this.mediaStream;
    }

    async stop(): Promise<{ blob: Blob; duration: number }> {
        return new Promise((resolve) => {
            if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
                resolve({ blob: new Blob([], { type: 'audio/webm' }), duration: 0 });
                return;
            }

            this.mediaRecorder.onstop = () => {
                const duration = (Date.now() - this.startTime) / 1000;
                const blob = new Blob(this.chunks, { type: 'audio/webm' });
                this.chunks = [];

                if (this.mediaStream) {
                    this.mediaStream.getTracks().forEach(track => track.stop());
                    this.mediaStream = null;
                }

                resolve({ blob, duration });
            };

            this.mediaRecorder.stop();
        });
    }
}
