const canvas = document.querySelector("canvas");
const GRID_SIZE = 1080;
const UPDATE_INTERVAL = 50;
const WORKGROUP_SIZE = 8;
let step = 0;

async function main() {
    if (!navigator.gpu) {
        throw new Error("Browser not compatible with WebGPU");
    }

    const adapter = await navigator.gpu.requestAdapter();

    if (!adapter) {
        throw new Error("Hardware acceleration is disabled");
    }

    // Initialize device and canvas
    const device = await adapter.requestDevice();
    const context = canvas.getContext("webgpu");
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
        device: device,
        format: canvasFormat,
    });

    // Declare vertex buffer
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
    const vertexBufferLayout = {
        arrayStride: 8,
        attributes: [{
            format: "float32x2",
            offset: 0,
            shaderLocation: 0,
        }],
    };
    device.queue.writeBuffer(vertexBuffer, /*bufferOffset=*/0, verticies);

    // Uniform buffer
    const uniformArray = new Float32Array([GRID_SIZE, GRID_SIZE]);
    const uniformBuffer = device.createBuffer({
        label: "Grid uniform",
        size: uniformArray.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(uniformBuffer, 0, uniformArray);

    // Cell state buffer
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

    // Randomize initialized values for a cell
    for (let i = 0; i < cellStateArray.length; ++i) {
        cellStateArray[i] = Math.random() > 0.6 ? 1 : 0;
    }
    device.queue.writeBuffer(cellStateStorage[0], 0, cellStateArray);

    // Module for simulation processing
    const simulationShaderModule = device.createShaderModule({
        label: "Game of Life simulation shader",
        code: `
            @group(0) @binding(0) var<uniform> grid: vec2f;

            @group(0) @binding(1) var<storage> cellStateIn: array<u32>;
            @group(0) @binding(2) var<storage, read_write> cellStateOut: array<u32>;

            fn cellIndex(cell: vec2u) -> u32 {
                return (cell.y % u32(grid.y)) * u32(grid.x) + (cell.x % u32(grid.x));
            }

            fn cellActive(x: u32, y: u32) -> u32 {
                return cellStateIn[cellIndex(vec2(x,y))];
            }

            @compute
            @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
            fn computeMain(@builtin(global_invocation_id) cell: vec3u) {
                let activeNeighbours = 
                    cellActive(cell.x + 1, cell.y + 1) + 
                    cellActive(cell.x + 1, cell.y) + 
                    cellActive(cell.x + 1, cell.y - 1) + 
                    cellActive(cell.x, cell.y - 1) + 
                    cellActive(cell.x, cell.y + 1) + 
                    cellActive(cell.x - 1, cell.y + 1) + 
                    cellActive(cell.x - 1, cell.y) + 
                    cellActive(cell.x - 1, cell.y - 1);

                let i = cellIndex(cell.xy);

                switch activeNeighbours {
                    // Active cells with 2 neighbours stay active
                    case 2: {
                        cellStateOut[i] = cellStateIn[i];
                    }
                    // Cells with 3 neighbours become or stay active
                    case 3: {
                        cellStateOut[i] = 1;
                    }
                    // Cells with < 2 or > 3 neighbours become inactive
                    default: {
                        cellStateOut[i] = 0;
                    }
                }
            }
        `
    });

    const bindGroupLayout = device.createBindGroupLayout({
        label: "Cell Bind Group Layout",
        entries: [{
            binding: 0,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
            buffer: {},
        }, {
            binding: 1,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
            buffer: { type: "read-only-storage" },
        }, {
            binding: 2,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "storage" },
        }]
    });

    const pipelineLayout = device.createPipelineLayout({
        label: "Cell Pipeline Layout",
        bindGroupLayouts: [ bindGroupLayout ],
    });

    const simulationPipeline = device.createComputePipeline({
        label: "Simulation Pipeline",
        layout: pipelineLayout,
        compute: {
            module: simulationShaderModule,
            entryPoint: "computeMain",
        }
    });

    // Module for cell shading
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
        layout: pipelineLayout,
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
            }, {
                binding: 1,
                resource: { buffer: cellStateStorage[0] }
            }, {
                binding: 2,
                resource: { buffer: cellStateStorage[1] }
            }],
        }),
        device.createBindGroup({
            label: "Cell renderer bind group B",
            layout: cellPipeline.getBindGroupLayout(0),
            entries: [{
                binding: 0,
                resource: { buffer: uniformBuffer }
            }, {
                binding: 1,
                resource: { buffer: cellStateStorage[1] }
            }, {
                binding: 2,
                resource: { buffer: cellStateStorage[0] }
            }],
        }),
    ];

    const data = {
        "cellPipeline": cellPipeline,
        "bindGroup": bindGroup,
        "vertexBuffer": vertexBuffer,
        "verticies": verticies,
        "simulationPipeline": simulationPipeline,
    };

    setInterval(updateGrid, UPDATE_INTERVAL, device, context, data);
}

function updateGrid(device, context, data) {
    const { cellPipeline, bindGroup, vertexBuffer, verticies, simulationPipeline } = data;
    const encoder = device.createCommandEncoder();

    const computePass = encoder.beginComputePass();
    computePass.setPipeline(simulationPipeline);
    computePass.setBindGroup(0, bindGroup[step % 2]);

    const workgroupCount = Math.ceil(GRID_SIZE / WORKGROUP_SIZE);
    computePass.dispatchWorkgroups(workgroupCount, workgroupCount);

    computePass.end();

    step++;

    
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