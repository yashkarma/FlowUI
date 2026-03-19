 // Initialize Icons
        lucide.createIcons();

        // --- STATE ---
        let nodes = [];
        let edges = [];
        let config = {
            pan: { x: 0, y: 0 },
            zoom: 1,
            MIN_ZOOM: 0.2,
            MAX_ZOOM: 3,
            GRID_SIZE: 20
        };

        let interaction = {
            mode: 'idle', // idle, panning, draggingNode, connecting
            activeNodeId: null,
            activeEdgeId: null,
            dragOffset: { x: 0, y: 0 },
            connectionStart: null // { nodeId, handle, x, y }
        };

        // DOM Elements
        const workspace = document.getElementById('workspace');
        const canvasLayer = document.getElementById('canvas-layer');
        const nodesLayer = document.getElementById('nodes-layer');
        const edgesLayer = document.getElementById('edges-layer');
        const tempEdgePath = document.getElementById('temp-edge');
        const zoomLabel = document.getElementById('zoom-level');

        // Generate ID
        const generateId = () => 'id_' + Math.random().toString(36).substr(2, 9);

        // --- INITIALIZATION ---
        function init() {
            // Setup Draggable Sidebar
            document.querySelectorAll('.drag-item').forEach(item => {
                item.addEventListener('dragstart', (e) => {
                    e.dataTransfer.setData('type', item.dataset.type);
                    // Add a slight delay to allow the drag image to be generated before we potentially do UI updates
                    setTimeout(() => interaction.mode = 'idle', 0);
                });
            });

            // Setup Workspace Drop
            workspace.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
            });

            workspace.addEventListener('drop', (e) => {
                e.preventDefault();
                const type = e.dataTransfer.getData('type');
                if (type) {
                    const canvasPos = screenToCanvas(e.clientX, e.clientY);
                    addNode(type, canvasPos.x - 60, canvasPos.y - 30); // center node on cursor (approx)
                }
            });

            // Global Mouse Events
            workspace.addEventListener('mousedown', handleMouseDown);
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
            workspace.addEventListener('wheel', handleWheel, { passive: false });

            // Keyboard Events
            window.addEventListener('keydown', (e) => {
                if (e.key === 'Delete' || e.key === 'Backspace') {
                    // Prevent deletion if typing in an input/contenteditable
                    if (document.activeElement.isContentEditable || document.activeElement.tagName === 'INPUT') return;
                    
                    if (interaction.activeNodeId) {
                        deleteNode(interaction.activeNodeId);
                    } else if (interaction.activeEdgeId) {
                        deleteEdge(interaction.activeEdgeId);
                    }
                }
            });

            // UI Controls
            document.getElementById('zoom-in').addEventListener('click', () => setZoom(config.zoom + 0.2));
            document.getElementById('zoom-out').addEventListener('click', () => setZoom(config.zoom - 0.2));
            document.getElementById('reset-view').addEventListener('click', () => {
                config.pan = { x: 0, y: 0 };
                setZoom(1);
            });
            document.getElementById('clear-btn').addEventListener('click', () => {
                if(confirm('Clear entire canvas?')) {
                    nodes = [];
                    edges = [];
                    interaction.activeNodeId = null;
                    interaction.activeEdgeId = null;
                    renderAll();
                }
            });

            // Click edge to select
            edgesLayer.addEventListener('click', (e) => {
                if(e.target.tagName === 'path' && e.target.id !== 'temp-edge') {
                    selectEdge(e.target.dataset.id);
                    e.stopPropagation(); // prevent workspace background click
                }
            });

            // Initial Sample Data to make MVP look good
            addNode('pill', 100, 200, "Start");
            addNode('rect', 350, 200, "Process Request");
            addNode('diamond', 600, 180, "Is Valid?");
            addNode('pill', 850, 200, "End");
            
            // Wait for next tick so DOM elements exist
            setTimeout(() => {
                edges.push({ id: generateId(), from: nodes[0].id, fromHandle: 'right', to: nodes[1].id, toHandle: 'left' });
                edges.push({ id: generateId(), from: nodes[1].id, fromHandle: 'right', to: nodes[2].id, toHandle: 'left' });
                edges.push({ id: generateId(), from: nodes[2].id, fromHandle: 'right', to: nodes[3].id, toHandle: 'left' });
                renderAll();
                
                // Center view
                const workspaceRect = workspace.getBoundingClientRect();
                config.pan = { x: workspaceRect.width/2 - 475, y: workspaceRect.height/2 - 200 };
                updateTransform();
            }, 50);
        }

        // --- CORE LOGIC ---

        function addNode(type, x, y, text) {
            let width = 120, height = 60;
            if (type === 'diamond') { width = 100; height = 100; }
            if (type === 'pill') { width = 100; height = 50; }

            const newNode = {
                id: generateId(),
                type,
                x, y,
                width, height,
                text: text || "New Node"
            };
            nodes.push(newNode);
            renderNodes();
            selectNode(newNode.id);
        }

        function deleteNode(id) {
            nodes = nodes.filter(n => n.id !== id);
            edges = edges.filter(e => e.from !== id && e.to !== id);
            interaction.activeNodeId = null;
            renderAll();
        }

        function deleteEdge(id) {
            edges = edges.filter(e => e.id !== id);
            interaction.activeEdgeId = null;
            renderEdges();
        }

        // --- EVENT HANDLERS ---

        function handleMouseDown(e) {
            // Ignore clicks on UI controls (buttons, aside)
            if (e.target.closest('button') || e.target.closest('aside')) return;

            // Explicitly pan when clicking the middle mouse button (scroll wheel click)
            if (e.button === 1) {
                e.preventDefault();
                interaction.mode = 'panning';
                interaction.dragOffset = {
                    x: e.clientX - config.pan.x,
                    y: e.clientY - config.pan.y
                };
                return;
            }

            // 1. Check if clicking on a node or its inner elements
            const nodeEl = e.target.closest('.flow-node');
            const handleEl = e.target.closest('.handle');

            if (handleEl) {
                // Start Connection
                e.stopPropagation();
                e.preventDefault();
                interaction.mode = 'connecting';
                interaction.connectionStart = {
                    nodeId: handleEl.dataset.nodeId,
                    handle: handleEl.dataset.handle
                };
                
                const pos = getHandlePosition(interaction.connectionStart.nodeId, interaction.connectionStart.handle);
                tempEdgePath.setAttribute('d', `M ${pos.x} ${pos.y} L ${pos.x} ${pos.y}`);
                tempEdgePath.classList.remove('hidden');
                return;
            }

            if (nodeEl) {
                // Select and Drag Node
                e.stopPropagation();
                // If double clicking to edit, don't initiate drag
                if (nodeEl.classList.contains('editing')) return;

                const nodeId = nodeEl.dataset.id;
                selectNode(nodeId);
                
                interaction.mode = 'draggingNode';
                const node = nodes.find(n => n.id === nodeId);
                
                const canvasPos = screenToCanvas(e.clientX, e.clientY);
                interaction.dragOffset = {
                    x: canvasPos.x - node.x,
                    y: canvasPos.y - node.y
                };
                return;
            }

            // 2. Clicked Background -> Start Panning
            // Allow panning if clicking anywhere else on the workspace
            if (e.target.tagName !== 'path') {
                selectNode(null);
                selectEdge(null);
            }
            
            interaction.mode = 'panning';
            interaction.dragOffset = {
                x: e.clientX - config.pan.x,
                y: e.clientY - config.pan.y
            };
        }

        function handleMouseMove(e) {
            if (interaction.mode === 'panning') {
                config.pan.x = e.clientX - interaction.dragOffset.x;
                config.pan.y = e.clientY - interaction.dragOffset.y;
                updateTransform();
            } 
            else if (interaction.mode === 'draggingNode') {
                const canvasPos = screenToCanvas(e.clientX, e.clientY);
                const node = nodes.find(n => n.id === interaction.activeNodeId);
                if (node) {
                    node.x = canvasPos.x - interaction.dragOffset.x;
                    node.y = canvasPos.y - interaction.dragOffset.y;
                    
                    // Grid snapping (optional, adds nice feel)
                    node.x = Math.round(node.x / 10) * 10;
                    node.y = Math.round(node.y / 10) * 10;

                    renderNodes(); // Updating position inline is faster, but this keeps state synced perfectly for MVP
                    renderEdges();
                }
            }
            else if (interaction.mode === 'connecting') {
                const startPos = getHandlePosition(interaction.connectionStart.nodeId, interaction.connectionStart.handle);
                const canvasPos = screenToCanvas(e.clientX, e.clientY);
                
                // Draw curve
                const pathStr = createSVGPath(startPos, canvasPos, interaction.connectionStart.handle, 'any');
                tempEdgePath.setAttribute('d', pathStr);
            }
        }

        function handleMouseUp(e) {
            if (interaction.mode === 'connecting') {
                tempEdgePath.classList.add('hidden');
                
                // Check if dropped on a handle
                const handleEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('.handle');
                if (handleEl) {
                    const toNodeId = handleEl.dataset.nodeId;
                    const toHandle = handleEl.dataset.handle;
                    const fromNodeId = interaction.connectionStart.nodeId;
                    const fromHandle = interaction.connectionStart.handle;

                    // Prevent self connection
                    if (fromNodeId !== toNodeId) {
                        edges.push({
                            id: generateId(),
                            from: fromNodeId,
                            fromHandle: fromHandle,
                            to: toNodeId,
                            toHandle: toHandle
                        });
                        renderEdges();
                    }
                }
            }

            interaction.mode = 'idle';
        }

        function handleWheel(e) {
            e.preventDefault();
            // Zooming
            const zoomDirection = e.deltaY > 0 ? -1 : 1;
            const newZoom = config.zoom + (zoomDirection * 0.1);
            
            if (newZoom >= config.MIN_ZOOM && newZoom <= config.MAX_ZOOM) {
                // Zoom towards mouse cursor
                const rect = workspace.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;

                // Calculate point before zoom
                const pointX = (mouseX - config.pan.x) / config.zoom;
                const pointY = (mouseY - config.pan.y) / config.zoom;

                config.zoom = newZoom;

                // Calculate pan to keep point under mouse
                config.pan.x = mouseX - pointX * config.zoom;
                config.pan.y = mouseY - pointY * config.zoom;

                updateTransform();
            }
        }

        // --- RENDERING ---

        function updateTransform() {
            canvasLayer.style.transform = `translate(${config.pan.x}px, ${config.pan.y}px) scale(${config.zoom})`;
            
            // Update grid background to match pan/zoom
            workspace.style.backgroundPosition = `${config.pan.x}px ${config.pan.y}px`;
            workspace.style.backgroundSize = `${config.GRID_SIZE * config.zoom}px ${config.GRID_SIZE * config.zoom}px`;
            
            zoomLabel.innerText = `${Math.round(config.zoom * 100)}%`;
        }

        function selectNode(id) {
            // Save active text edit if any
            document.querySelectorAll('.flow-node.editing').forEach(el => {
                el.classList.remove('editing');
                const textEl = el.querySelector('.node-text');
                textEl.contentEditable = false;
                const node = nodes.find(n => n.id === el.dataset.id);
                if(node) node.text = textEl.innerText;
            });

            interaction.activeNodeId = id;
            if(id) interaction.activeEdgeId = null; // deselect edge
            
            document.querySelectorAll('.flow-node').forEach(el => {
                if (el.dataset.id === id) el.classList.add('selected');
                else el.classList.remove('selected');
            });
            renderEdges(); // Update selected color state
        }

        function selectEdge(id) {
            interaction.activeEdgeId = id;
            if(id) interaction.activeNodeId = null; // deselect node
            renderNodes(); // remove node selections
            renderEdges();
        }

        function renderAll() {
            renderNodes();
            renderEdges();
        }

        function renderNodes() {
            nodesLayer.innerHTML = ''; // Clear (for MVP, simple redraw is fine)
            
            nodes.forEach(node => {
                const el = document.createElement('div');
                el.className = `flow-node shape-${node.type} pointer-events-auto`;
                el.dataset.id = node.id;
                el.style.left = `${node.x}px`;
                el.style.top = `${node.y}px`;
                el.style.width = `${node.width}px`;
                el.style.height = `${node.height}px`;
                
                if (node.id === interaction.activeNodeId) el.classList.add('selected');

                // Inner Text
                const textDiv = document.createElement('div');
                textDiv.className = 'node-text';
                textDiv.innerText = node.text;
                el.appendChild(textDiv);

                // Handles
                const handles = ['top', 'right', 'bottom', 'left'];
                handles.forEach(pos => {
                    const handle = document.createElement('div');
                    handle.className = `handle handle-${pos}`;
                    handle.dataset.nodeId = node.id;
                    handle.dataset.handle = pos;
                    el.appendChild(handle);
                });

                // Double click to edit
                el.addEventListener('dblclick', (e) => {
                    e.stopPropagation();
                    el.classList.add('editing');
                    textDiv.contentEditable = true;
                    textDiv.focus();
                    
                    // Move cursor to end
                    const range = document.createRange();
                    const sel = window.getSelection();
                    range.selectNodeContents(textDiv);
                    range.collapse(false);
                    sel.removeAllRanges();
                    sel.addRange(range);
                });

                // Prevent drag logic when interacting with text textDiv
                textDiv.addEventListener('mousedown', (e) => {
                    if (el.classList.contains('editing')) e.stopPropagation();
                });
                // Save on blur
                textDiv.addEventListener('blur', () => {
                    el.classList.remove('editing');
                    textDiv.contentEditable = false;
                    node.text = textDiv.innerText;
                });

                nodesLayer.appendChild(el);
            });
        }

        function renderEdges() {
            // Keep the temp edge path, remove others
            const paths = edgesLayer.querySelectorAll('path:not(#temp-edge)');
            paths.forEach(p => p.remove());

            edges.forEach(edge => {
                const startPos = getHandlePosition(edge.from, edge.fromHandle);
                const endPos = getHandlePosition(edge.to, edge.toHandle);
                
                if (!startPos || !endPos) return; // Node might have been deleted

                const pathStr = createSVGPath(startPos, endPos, edge.fromHandle, edge.toHandle);
                
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('d', pathStr);
                path.setAttribute('class', `edge-path ${edge.id === interaction.activeEdgeId ? 'selected' : ''}`);
                path.dataset.id = edge.id;
                
                // Add invisible wider path for easier clicking
                const clickArea = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                clickArea.setAttribute('d', pathStr);
                clickArea.setAttribute('stroke', 'transparent');
                clickArea.setAttribute('stroke-width', '15');
                clickArea.setAttribute('fill', 'none');
                clickArea.dataset.id = edge.id;
                clickArea.style.cursor = 'pointer';
                clickArea.style.pointerEvents = 'stroke';

                edgesLayer.appendChild(clickArea);
                edgesLayer.appendChild(path);
            });
        }

        // --- UTILS ---

        function screenToCanvas(clientX, clientY) {
            const rect = workspace.getBoundingClientRect();
            return {
                x: (clientX - rect.left - config.pan.x) / config.zoom,
                y: (clientY - rect.top - config.pan.y) / config.zoom
            };
        }

        function getHandlePosition(nodeId, handlePos) {
            const node = nodes.find(n => n.id === nodeId);
            if (!node) return null;
            
            let x = node.x;
            let y = node.y;

            if (handlePos === 'top') { x += node.width / 2; }
            else if (handlePos === 'right') { x += node.width; y += node.height / 2; }
            else if (handlePos === 'bottom') { x += node.width / 2; y += node.height; }
            else if (handlePos === 'left') { y += node.height / 2; }

            return { x, y };
        }

        function createSVGPath(start, end, startHandle, endHandle) {
            // A nice bezier curve connecting points based on orientation
            const dx = end.x - start.x;
            const dy = end.y - start.y;
            
            // Distance for control points
            const dist = Math.max(Math.abs(dx), Math.abs(dy)) * 0.5;
            
            let cp1x = start.x, cp1y = start.y;
            let cp2x = end.x, cp2y = end.y;

            // Control Point 1
            if (startHandle === 'top') cp1y -= dist;
            else if (startHandle === 'bottom') cp1y += dist;
            else if (startHandle === 'left') cp1x -= dist;
            else if (startHandle === 'right') cp1x += dist;

            // Control Point 2
            if (endHandle === 'top') cp2y -= dist;
            else if (endHandle === 'bottom') cp2y += dist;
            else if (endHandle === 'left') cp2x -= dist;
            else if (endHandle === 'right') cp2x += dist;
            else {
                // When dragging a temp edge to "any", curve based on simple vector
                cp2x = end.x - dx*0.2;
                cp2y = end.y - dy*0.2;
            }

            return `M ${start.x} ${start.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${end.x} ${end.y}`;
        }

        // Boot
        init();