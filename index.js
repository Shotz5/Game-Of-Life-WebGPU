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

    const verticies = new Float32Array([
        // X      Y
        -0.8,  -0.8, // Triangle 1 (blue)
         0.8,  -0.8,
         0.8,   0.8,

        -0.8,  -0.8, // Triangle 2 (red)
         0.8,   0.8,
        -0.8,   0.8,
    ]);
    const vertexBuffer = device.createBuffer({
        label: "Cell verticies",
        size: verticies.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(vertexBuffer, /*bufferOffset=*/0, verticies);
    const vertexBufferLayout = {
        arrayStride: 8,
        attributes: [{
            format: "float32x2",
            offset: 0,
            shaderLocation: 0,
        }],
    };
    const cellShaderModule = device.createShaderModule({
        label: "Cell shader",
        code: `
            @vertex
            fn vertexMain(@location(0) pos: vec2f) -> @builtin(position) vec4f {
                return vec4f(pos, 0, 1);
            }

            @fragment
            fn fragmentMain() -> @location(0) vec4f {
                return vec4f(0, 0, 0.6, 1);
            }
        `
    });
    const cellPipeline = device.createRenderPipeline({
        label: "Cell pipeline",
        layout: "auto",
        vertex: {
            module: cellShaderModule,
            entryPoint: "vertexMain",
            buffers: [vertexBufferLayout],
        },
        fragment: {
            module: cellShaderModule,
            entryPoint: "fragmentMain",
            targets: [{
                format: canvasFormat
            }]
        },
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
    pass.setPipeline(cellPipeline);
    pass.setVertexBuffer(0, vertexBuffer);
    pass.draw(verticies.length / 2);
    pass.end();
    device.queue.submit([encoder.finish()]);
}