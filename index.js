const canvas = document.querySelector("canvas");
const GRID_SIZE = 32;
const UPDATE_INTERVAL = 200;
let step = 0;

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

    const cellStateArray = new Uint32Array(GRID_SIZE * GRID_SIZE);
    const cellStateStorage = [
        device.createBuffer({
            label: "Cell state A",
            size: cellStateArray.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        }),
        device.createBuffer({
            label: "Cell state B",
            size: cellStateArray.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        }),
    ];
    // Mark every 3rd cell of the grid as active
    for (let i = 0; i < cellStateArray.length; i += 3) {
        cellStateArray[i] = 1;
    }
    device.queue.writeBuffer(cellStateStorage[0], 0, cellStateArray);

    // Mark every 2nd cell of the grid as active
    for (let i = 0; i < cellStateArray.length; i++) {
        cellStateArray[i] = i % 2;
    }
    device.queue.writeBuffer(cellStateStorage[1], 0, cellStateArray);
      

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
            struct VertexInput {
                @location(0) pos: vec2f,
                @builtin(instance_index) instance: u32,
            };
            
            struct VertexOutput {
                @builtin(position) pos: vec4f,
                @location(0) cell: vec2f,
            };

            @group(0) @binding(0) var<uniform> grid: vec2f;
            @group(0) @binding(1) var<storage> cellState: array<u32>;

            @vertex
            fn vertexMain(input: VertexInput) -> VertexOutput {
                let i = f32(input.instance);
                let cell = vec2f(i % grid.x, floor(i / grid.x));
                let state = f32(cellState[input.instance]);

                let cellOffset = cell / grid * 2;
                let gridPos = (input.pos * state + 1) / grid - 1 + cellOffset;

                var output: VertexOutput;
                output.pos = vec4f(gridPos, 0, 1);
                output.cell = cell;
                return output;
            }

            @fragment
            fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
                let c = input.cell / grid;
                return vec4f(1 - c.x, c, 1);
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

    const bindGroup = [
        device.createBindGroup({
            label: "Cell renderer bind group A",
            layout: cellPipeline.getBindGroupLayout(0),
            entries: [{
                binding: 0,
                resource: { buffer: uniformBuffer }
            },
            {
                binding: 1,
                resource: { buffer: cellStateStorage[0] }
            }],
        }),
        device.createBindGroup({
            label: "Cell renderer bind group B",
            layout: cellPipeline.getBindGroupLayout(0),
            entries: [{
                binding: 0,
                resource: { buffer: uniformBuffer }
            },
            {
                binding: 1,
                resource: { buffer: cellStateStorage[1] }
            }],
        }),
    ];

    const data = {
        "cellPipeline": cellPipeline,
        "bindGroup": bindGroup,
        "vertexBuffer": vertexBuffer,
        "verticies": verticies,
    };

    setInterval(updateGrid, UPDATE_INTERVAL, device, context, data);
}

function updateGrid(device, context, data) {
    const { cellPipeline, bindGroup, vertexBuffer, verticies } = data;
    step++;

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
        colorAttachments: [{
            view: context.getCurrentTexture().createView(),
            loadOp: "clear",
            clearValue: [0, 0, 0, 1],
            storeOp: "store",
        }]
    });

    pass.setPipeline(cellPipeline);
    pass.setBindGroup(0, bindGroup[step % 2]);
    pass.setVertexBuffer(0, vertexBuffer);
    pass.draw(verticies.length / 2, GRID_SIZE * GRID_SIZE);
    pass.end();
    device.queue.submit([encoder.finish()]);
}

main();