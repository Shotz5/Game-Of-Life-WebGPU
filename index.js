const canvas = document.querySelector("canvas");
const GRID_SIZE = 32;
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

    const uniformArray = new Float32Array([GRID_SIZE, GRID_SIZE]);
    const uniformBuffer = device.createBuffer({
        label: "Grid uniform",
        size: uniformArray.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(uniformBuffer, 0, uniformArray);

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
            @group(0) @binding(0) var<uniform> grid: vec2f;

            @vertex
            fn vertexMain(@location(0) pos: vec2f, @builtin(instance_index) instance: u32) -> @builtin(position) vec4f {
                let i = f32(instance);
                let cell = vec2f(i % grid.x, floor(i / grid.x));
                let cellOffset = cell / grid * 2;
                let gridPos = (pos + 1) / grid - 1 + cellOffset;
                return vec4f(gridPos, 0, 1);
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
    const bindGroup = device.createBindGroup({
        label: "Cell renderer bind group",
        layout: cellPipeline.getBindGroupLayout(0),
        entries: [{
            binding: 0,
            resource: { buffer: uniformBuffer }
        }],
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
    pass.setBindGroup(0, bindGroup);
    pass.draw(verticies.length / 2, GRID_SIZE * GRID_SIZE);
    pass.end();
    device.queue.submit([encoder.finish()]);
}