const canvas = document.querySelector("canvas");
main();

async function main() {
    if (!navigator.gpu) {
        throw new Error("Browser not compatible with WebGPU");
    }

    const adapter = await navigator.gpu.requestAdapter();

    if (!adapter) {
        throw new Error("Hardware acceleration is disabled");
    }

    const device = await adapter.requestDevice();
    const context = canvas.getContext("webgpu");
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
        device: device,
        format: canvasFormat,
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
        colorAttachments: [{
            view: context.getCurrentTexture().createView(),
            loadOp: "clear",
            clearValue: [1, 0, 0, 1],
            storeOp: "store",
        }]
    });
    pass.end();
    device.queue.submit([encoder.finish()]);
}