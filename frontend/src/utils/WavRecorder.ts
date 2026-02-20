
export class WavRecorder {
    private mediaStream: MediaStream | null = null;
    private audioContext: AudioContext | null = null;
    private mediaStreamSource: MediaStreamAudioSourceNode | null = null;
    private scriptProcessor: ScriptProcessorNode | null = null;
    private chunks: Float32Array[] = [];
    private isRecording: boolean = false;
    private sampleRate: number = 44100;

    async start(): Promise<MediaStream | null> {
        this.chunks = [];
        this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        this.sampleRate = this.audioContext.sampleRate;
        this.mediaStreamSource = this.audioContext.createMediaStreamSource(this.mediaStream);

        // bufferSize: 4096, inputChannels: 1, outputChannels: 1
        this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);

        this.scriptProcessor.onaudioprocess = (event) => {
            if (!this.isRecording) return;
            const channelData = event.inputBuffer.getChannelData(0);
            // Clone the data because the buffer is reused
            this.chunks.push(new Float32Array(channelData));
        };

        this.mediaStreamSource.connect(this.scriptProcessor);
        this.scriptProcessor.connect(this.audioContext.destination);
        this.isRecording = true;
        return this.mediaStream;  // ← expose stream for volume monitoring
    }

    /** Returns the active MediaStream (for external AnalyserNode attachment) */
    getStream(): MediaStream | null {
        return this.mediaStream;
    }

    async stop(): Promise<Blob> {
        this.isRecording = false;

        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }

        if (this.mediaStreamSource && this.scriptProcessor) {
            this.mediaStreamSource.disconnect();
            this.scriptProcessor.disconnect();
        }

        if (this.audioContext) {
            await this.audioContext.close();
            this.audioContext = null;
        }

        return this.exportWAV(this.chunks);
    }

    private exportWAV(chunks: Float32Array[]): Blob {
        const buffer = this.mergeBuffers(chunks);
        const dataview = this.encodeWAV(buffer);
        return new Blob([dataview as unknown as BlobPart], { type: 'audio/wav' });
    }

    private mergeBuffers(availableChunks: Float32Array[]): Float32Array {
        const length = availableChunks.reduce((acc, chunk) => acc + chunk.length, 0);
        const result = new Float32Array(length);
        let offset = 0;
        for (const chunk of availableChunks) {
            result.set(chunk, offset);
            offset += chunk.length;
        }
        return result;
    }

    private encodeWAV(samples: Float32Array): DataView {
        const buffer = new ArrayBuffer(44 + samples.length * 2);
        const view = new DataView(buffer);
        const sampleRate = this.sampleRate;

        const writeString = (view: DataView, offset: number, string: string) => {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        };

        /* RIFF identifier */
        writeString(view, 0, 'RIFF');
        /* RIFF chunk length */
        view.setUint32(4, 36 + samples.length * 2, true);
        /* RIFF type */
        writeString(view, 8, 'WAVE');
        /* format chunk identifier */
        writeString(view, 12, 'fmt ');
        /* format chunk length */
        view.setUint32(16, 16, true);
        /* sample format (raw) */
        view.setUint16(20, 1, true);
        /* channel count */
        view.setUint16(22, 1, true);
        /* sample rate */
        view.setUint32(24, sampleRate, true);
        /* byte rate (sample rate * block align) */
        view.setUint32(28, sampleRate * 2, true);
        /* block align (channel count * bytes per sample) */
        view.setUint16(32, 2, true);
        /* bits per sample */
        view.setUint16(34, 16, true);
        /* data chunk identifier */
        writeString(view, 36, 'data');
        /* data chunk length */
        view.setUint32(40, samples.length * 2, true);

        this.floatTo16BitPCM(view, 44, samples);

        return view;
    }

    private floatTo16BitPCM(output: DataView, offset: number, input: Float32Array) {
        for (let i = 0; i < input.length; i++, offset += 2) {
            const s = Math.max(-1, Math.min(1, input[i]));
            output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }
    }
}
