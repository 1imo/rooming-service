class RoomEditor {
    constructor(canvasId, measurementsId) {
        this.points = [];
        this.isDragging = false;
        this.selectedPointIndex = null;
        this.scale = 100; // 100 pixels = 1 meter
        this.dpi = window.devicePixelRatio || 1;
        this.isPanning = false;
        this.panStart = null;
        this.roomOffsets = [{ x: 0, y: 0 }];  // Initialize first room's offset
        this.hoverPoint = null;
        this.hoverSegmentIndex = null;
        this.measurementInput = null;
        this.roomAngles = [new Map()];  // Initialize with empty map for first room
        this.contextMenu = null;
        this.roomNames = [''];
        this.roomFixedLengths = [new Map()]; // Initialize with empty map for first room

        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d', { alpha: false });
        this.measurements = document.getElementById(measurementsId);

        // Initialize with 1x1 square first
        this.initializeSquare();
        
        // Then set up rooms array with the initialized square
        this.rooms = [this.points];
        this.activeRoomIndex = 0;

        // Add button click handler
        const addRoomButton = document.querySelector('.add-room-button');
        addRoomButton.addEventListener('click', () => this.addNewRoom());

        // Set up high DPI canvas
        this.setupCanvas();
        window.addEventListener('resize', () => this.setupCanvas());

        // Call updateMeasurements immediately after initialization
        this.updateMeasurements();

        // Initialize event listeners
        this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
        this.canvas.addEventListener('mouseup', () => this.onMouseUp());
        this.canvas.addEventListener('dblclick', (e) => this.onDoubleClick(e));

        // Remove the click event listener that might be causing conflicts
        this.canvas.removeEventListener('click', this.onCanvasClick);

        // Update cursor based on context
        this.canvas.addEventListener('mousemove', (e) => {
            const pos = this.getMousePos(e);
            this.updateCursor(pos);
        });

        // Prevent default context menu
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
        
        // Add right-click handler
        this.canvas.addEventListener('mousedown', (e) => {
            if (e.button === 2) { // Right click
                e.preventDefault();
                this.handleRightClick(e);
            }
        });

        // Close context menu when clicking outside
        document.addEventListener('click', (e) => {
            if (this.contextMenu && !this.contextMenu.contains(e.target)) {
                this.contextMenu.remove();
                this.contextMenu = null;
            }
        });

        // Initial render
        this.render();
    }

    initializeSquare() {
        // Create a 1x1 meter square centered in the canvas
        const canvasCenter = {
            x: (this.canvas.width / this.dpi / this.scale / 2),
            y: (this.canvas.height / this.dpi / this.scale / 2)
        };

        this.points = [
            { x: -0.5, y: -0.5 }, // Top-left
            { x: 0.5, y: -0.5 },  // Top-right
            { x: 0.5, y: 0.5 },   // Bottom-right
            { x: -0.5, y: 0.5 }   // Bottom-left
        ];

        // Set initial offset to center the square
        this.roomOffsets[0] = {
            x: canvasCenter.x / this.scale,
            y: canvasCenter.y / this.scale
        };
    }

    setupCanvas() {
        const container = this.canvas.parentElement;
        const displayWidth = container.clientWidth;
        const displayHeight = container.clientHeight;

        // Set display size in CSS pixels
        this.canvas.style.width = `${displayWidth}px`;
        this.canvas.style.height = `${displayHeight}px`;

        // Set actual pixel size scaled for DPI
        this.canvas.width = Math.floor(displayWidth * this.dpi);
        this.canvas.height = Math.floor(displayHeight * this.dpi);

        // Normalize coordinate system
        this.ctx.scale(this.dpi, this.dpi);

        // Disable image smoothing
        this.ctx.imageSmoothingEnabled = false;
    }

    getMousePos(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) / this.scale,
            y: (e.clientY - rect.top) / this.scale
        };
    }

    findClosestPointOnSegment(pos, p1, p2) {
        // Remove offset from position for calculation
        const posWithoutOffset = {
            x: pos.x - this.roomOffsets[this.activeRoomIndex].x,
            y: pos.y - this.roomOffsets[this.activeRoomIndex].y
        };
        
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        
        if (length === 0) return p1;

        const t = Math.max(0, Math.min(1, (
            (posWithoutOffset.x - p1.x) * dx +
            (posWithoutOffset.y - p1.y) * dy
        ) / (length * length)));

        return {
            x: p1.x + t * dx,
            y: p1.y + t * dy,
            t: t
        };
    }

    onMouseMove(e) {
        const pos = this.getMousePos(e);

        if (this.isPanning && !this.isDragging) {
            const dx = (e.clientX - this.panStart.x) / this.scale;
            const dy = (e.clientY - this.panStart.y) / this.scale;
            this.roomOffsets[this.activeRoomIndex].x += dx;
            this.roomOffsets[this.activeRoomIndex].y += dy;
            this.panStart = { x: e.clientX, y: e.clientY };
            this.render();
            return;
        }

        if (this.isDragging && this.selectedPointIndex !== null) {
            // Update point position
            const newPos = {
                x: pos.x - this.roomOffsets[this.activeRoomIndex].x,
                y: pos.y - this.roomOffsets[this.activeRoomIndex].y
            };

            // Store original position
            const originalPos = { ...this.points[this.selectedPointIndex] };
            
            // Update the point position
            this.points[this.selectedPointIndex] = newPos;

            // Enforce fixed lengths
            this.enforceFixedLengths(this.selectedPointIndex);

            // If we couldn't maintain fixed lengths, revert the move
            if (!this.areFixedLengthsValid()) {
                this.points[this.selectedPointIndex] = originalPos;
            }

            this.enforceAllAngles();
            this.updateMeasurements();
            this.render();
            return;
        }

        // Update hover point
        if (!this.isPanning && !this.isDragging) {
            let closestDist = Infinity;
            this.hoverPoint = null;
            this.hoverSegmentIndex = null;

            for (let i = 0; i < this.points.length; i++) {
                const j = (i + 1) % this.points.length;
                const p1 = this.points[i];
                const p2 = this.points[j];

                const closest = this.findClosestPointOnSegment(pos, p1, p2);
                const closestWithOffset = {
                    x: closest.x + this.roomOffsets[this.activeRoomIndex].x,
                    y: closest.y + this.roomOffsets[this.activeRoomIndex].y
                };
                
                const dist = Math.hypot(
                    (closestWithOffset.x - pos.x) * this.scale,
                    (closestWithOffset.y - pos.y) * this.scale
                );

                if (dist < 15 && dist < closestDist) {
                    closestDist = dist;
                    this.hoverPoint = closestWithOffset;
                    this.hoverSegmentIndex = i;
                }
            }
        }

        this.updateCursor(pos);
        this.render();
    }

    enforceAllAngles() {
        let iterations = 0;
        const maxIterations = 10;
        let angleFixed;

        do {
            angleFixed = false;
            // Only enforce angles for the active room
            const activeAngles = this.roomAngles[this.activeRoomIndex];
            
            for (let pointIndex = 0; pointIndex < this.points.length; pointIndex++) {
                const targetAngle = activeAngles.get(pointIndex);
                if (targetAngle === undefined) continue;

                const numPoints = this.points.length;
                const prev = this.points[(pointIndex - 1 + numPoints) % numPoints];
                const current = this.points[pointIndex];
                const next = this.points[(pointIndex + 1) % numPoints];

                const currentAngle = this.calculateCurrentAngle(pointIndex);

                if (Math.abs(currentAngle - targetAngle) > 0.1) {
                    angleFixed = true;

                    const v1 = {
                        x: prev.x - current.x,
                        y: prev.y - current.y
                    };
                    const v2 = {
                        x: next.x - current.x,
                        y: next.y - current.y
                    };

                    const angleToRotate = targetAngle - currentAngle;
                    const rotatedVector = this.rotateVector(v2, angleToRotate);
                    
                    this.points[(pointIndex + 1) % numPoints] = {
                        x: current.x + rotatedVector.x,
                        y: current.y + rotatedVector.y
                    };
                }
            }
            iterations++;
        } while (angleFixed && iterations < maxIterations);
    }

    rotatePointAroundCenter(center, point, angleDegrees) {
        const angleRadians = angleDegrees * Math.PI / 180;
        const cos = Math.cos(angleRadians);
        const sin = Math.sin(angleRadians);
        
        // Translate point to origin
        const dx = point.x - center.x;
        const dy = point.y - center.y;
        
        // Rotate point
        point.x = center.x + dx * cos - dy * sin;
        point.y = center.y + dx * sin + dy * cos;
    }

    onMouseDown(e) {
        const pos = this.getMousePos(e);
        
        // Prevent default to avoid text selection
        e.preventDefault();
        
        // Check if clicking on a different room
        this.rooms.forEach((roomPoints, index) => {
            if (this.isPointInRoom(pos, roomPoints, index)) {
                this.activeRoomIndex = index;
                this.points = this.rooms[this.activeRoomIndex];
                // No need to reset or carry over room name when switching rooms
                this.updateMeasurements();
                this.render();
                return;
            }
        });

        // Check if we're clicking a measurement first
        if (this.checkMeasurementClick(pos)) {
            return;
        }

        // Check if clicking near existing point
        const pointIndex = this.points.findIndex(p => 
            Math.hypot(
                ((p.x + this.roomOffsets[this.activeRoomIndex].x) * this.scale) - (pos.x * this.scale),
                ((p.y + this.roomOffsets[this.activeRoomIndex].y) * this.scale) - (pos.y * this.scale)
            ) < 10
        );

        if (pointIndex !== -1) {
            this.selectedPointIndex = pointIndex;
            this.isDragging = true;
            return;
        }

        // Check for line hover point
        if (this.hoverPoint && this.hoverSegmentIndex !== null) {
            this.points.splice(this.hoverSegmentIndex + 1, 0, {
                x: this.hoverPoint.x - this.roomOffsets[this.activeRoomIndex].x,
                y: this.hoverPoint.y - this.roomOffsets[this.activeRoomIndex].y
            });
            this.selectedPointIndex = this.hoverSegmentIndex + 1;
            this.isDragging = true;
            return;
        }

        // Check for panning
        if (this.isInPanningArea(pos)) {
            this.isPanning = true;
            this.panStart = { x: e.clientX, y: e.clientY };
        }
    }

    checkMeasurementClick(pos) {
        const scaledPos = {
            x: pos.x * this.scale,
            y: pos.y * this.scale
        };

        for (let i = 0; i < this.points.length; i++) {
            const j = (i + 1) % this.points.length;
            if (j === 0 && this.points.length < 3) continue;

            const p1 = {
                x: (this.points[i].x + this.roomOffsets[this.activeRoomIndex].x) * this.scale,
                y: (this.points[i].y + this.roomOffsets[this.activeRoomIndex].y) * this.scale
            };
            const p2 = {
                x: (this.points[j].x + this.roomOffsets[this.activeRoomIndex].x) * this.scale,
                y: (this.points[j].y + this.roomOffsets[this.activeRoomIndex].y) * this.scale
            };

            // Calculate line angle and midpoint
            const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
            const midX = (p1.x + p2.x) / 2;
            const midY = (p1.y + p2.y) / 2;

            // Calculate text offset (same as in render method)
            const textHeight = 14;
            const padding = 4;
            const offset = textHeight + padding;
            const perpAngle = angle - Math.PI/2;
            const offsetX = Math.cos(perpAngle) * offset;
            const offsetY = Math.sin(perpAngle) * offset;

            // Adjust midpoint by offset
            const textX = midX + offsetX;
            const textY = midY + offsetY;

            // Calculate click position relative to text center
            const dx = scaledPos.x - textX;
            const dy = scaledPos.y - textY;

            // Rotate click position to align with text orientation
            let labelAngle = angle;
            if (angle > Math.PI/2 || angle < -Math.PI/2) {
                labelAngle += Math.PI;
            }
            const rotatedX = dx * Math.cos(-labelAngle) - dy * Math.sin(-labelAngle);
            const rotatedY = dx * Math.sin(-labelAngle) + dy * Math.cos(-labelAngle);

            // Check if click is within text bounds
            const length = this.calculateSegmentLength(this.points[i], this.points[j]);
            const text = length.toFixed(2) + 'm';
            const metrics = this.ctx.measureText(text);
            const textWidth = metrics.width;

            if (Math.abs(rotatedX) < textWidth/2 + padding && 
                Math.abs(rotatedY) < textHeight/2 + padding) {
                this.startMeasurementEdit(i, j);
                return true;
            }
        }
        return false;
    }

    onMouseUp() {
        if (this.isDragging && this.selectedPointIndex !== null) {
            // Final angle enforcement after drag
            this.enforceAllAngles();
        }
        
        this.isPanning = false;
        this.isDragging = false;
        this.selectedPointIndex = null;
        this.render();
    }

    onDoubleClick(e) {
        const pos = this.getMousePos(e);
        
        // Find if double-clicking near a point
        const pointIndex = this.points.findIndex(p => 
            Math.hypot((p.x * this.scale) - (pos.x * this.scale), 
                      (p.y * this.scale) - (pos.y * this.scale)) < 10
        );

        if (pointIndex !== -1 && this.points.length > 3) {
            this.points.splice(pointIndex, 1);
            this.updateMeasurements();
            this.render();
        }
    }

    calculateArea() {
        let area = 0;
        for (let i = 0; i < this.points.length; i++) {
            const j = (i + 1) % this.points.length;
            area += this.points[i].x * this.points[j].y;
            area -= this.points[j].x * this.points[i].y;
        }
        return Math.abs(area) / 2;
    }

    calculatePerimeter() {
        let perimeter = 0;
        for (let i = 0; i < this.points.length; i++) {
            const j = (i + 1) % this.points.length;
            const dx = this.points[j].x - this.points[i].x;
            const dy = this.points[j].y - this.points[i].y;
            perimeter += Math.sqrt(dx * dx + dy * dy);
        }
        return perimeter;
    }

    calculateBoundingArea() {
        if (this.points.length < 3) return 0;

        // Find min and max coordinates
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        this.points.forEach(point => {
            minX = Math.min(minX, point.x);
            minY = Math.min(minY, point.y);
            maxX = Math.max(maxX, point.x);
            maxY = Math.max(maxY, point.y);
        });

        // Calculate width and height
        const width = maxX - minX;
        const height = maxY - minY;

        return width * height;
    }

    updateMeasurements() {
        const trueArea = this.calculateArea();
        const boundingArea = this.calculateBoundingArea();
        const perimeter = this.calculatePerimeter();
        const carpetPerimeter = perimeter + (this.points.length * 0.2); // Add 20cm per corner

        this.measurements.innerHTML = `
            <div class="measurement-item">
                <span>True Area</span>
                <span>${trueArea.toFixed(2)} m²</span>
            </div>
            <div class="measurement-item">
                <span>Carpet Area</span>
                <span>${boundingArea.toFixed(2)} m²</span>
            </div>
            <div class="measurement-item">
                <span>True Perimeter</span>
                <span>${perimeter.toFixed(2)} m</span>
            </div>
            <div class="measurement-item">
                <span>Carpet Perimeter</span>
                <span>${carpetPerimeter.toFixed(2)} m</span>
            </div>
        `;
    }

    calculateSegmentLength(point1, point2) {
        const dx = point2.x - point1.x;
        const dy = point2.y - point1.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    onCanvasClick(e) {
        const pos = this.getMousePos(e);
        
        // Check if clicking near a measurement label
        for (let i = 0; i < this.points.length; i++) {
            const j = (i + 1) % this.points.length;
            if (j === 0 && this.points.length < 3) continue;

            const p1 = this.points[i];
            const p2 = this.points[j];
            
            // Calculate midpoint of the line segment
            const midX = (p1.x + p2.x) / 2 * this.scale;
            const midY = (p1.y + p2.y) / 2 * this.scale;
            
            // Check if click is near the midpoint
            const dx = pos.x * this.scale - midX;
            const dy = pos.y * this.scale - midY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance < 20) { // 20px click radius
                this.startMeasurementEdit(i, j);
                return;
            }
        }
    }

    startMeasurementEdit(index1, index2) {
        if (this.measurementInput) {
            this.measurementInput.remove();
        }

        const p1 = this.points[index1];
        const p2 = this.points[index2];
        const length = this.calculateSegmentLength(p1, p2);

        // Calculate position for input
        const midX = ((p1.x + p2.x) / 2 + this.roomOffsets[this.activeRoomIndex].x) * this.scale;
        const midY = ((p1.y + p2.y) / 2 + this.roomOffsets[this.activeRoomIndex].y) * this.scale;
        const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);

        // Calculate text offset
        const textHeight = 14;
        const padding = 4;
        const offset = textHeight + padding;
        const perpAngle = angle - Math.PI/2;
        const offsetX = Math.cos(perpAngle) * offset;
        const offsetY = Math.sin(perpAngle) * offset;

        // Create input element
        const input = document.createElement('input');
        input.type = 'number';
        input.step = '0.01';
        input.value = length.toFixed(2);
        input.style.position = 'fixed';
        input.style.width = '80px';
        input.style.fontSize = '14px';
        input.style.padding = '2px';
        input.style.border = '1px solid #2563eb';
        input.style.borderRadius = '4px';
        input.style.zIndex = '1000';
        
        // Position input at text location
        const rect = this.canvas.getBoundingClientRect();
        input.style.left = (rect.left + midX + offsetX - 40) + 'px';
        input.style.top = (rect.top + midY + offsetY - 10) + 'px';
        
        // Handle input changes
        const handleChange = () => {
            const newLength = parseFloat(input.value);
            if (!isNaN(newLength) && newLength > 0) {
                // Store the fixed length for this segment
                const segmentKey = `${index1}-${index2}`;
                this.roomFixedLengths[this.activeRoomIndex].set(segmentKey, newLength);
                this.adjustSegmentLength(index1, index2, newLength);
            }
            input.remove();
            this.measurementInput = null;
            this.updateCursor(this.getMousePos({ clientX: 0, clientY: 0 }));
        };

        input.addEventListener('change', handleChange);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                handleChange();
            } else if (e.key === 'Escape') {
                input.remove();
                this.measurementInput = null;
                this.updateCursor(this.getMousePos({ clientX: 0, clientY: 0 }));
            }
        });
        
        input.addEventListener('blur', handleChange);
        
        document.body.appendChild(input);
        this.measurementInput = input;
        
        // Focus and select after a short delay to ensure proper positioning
        setTimeout(() => {
            input.focus();
            input.select();
        }, 50);
    }

    adjustSegmentLength(index1, index2, newLength) {
        const p1 = this.points[index1];
        const p2 = this.points[index2];
        
        // Calculate current length and scale factor
        const currentLength = this.calculateSegmentLength(p1, p2);
        const scale = newLength / currentLength;
        
        // Calculate vector between points
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        
        // Update second point position
        this.points[index2] = {
            x: p1.x + dx * scale,
            y: p1.y + dy * scale
        };
        
        // Enforce angles after length adjustment
        this.enforceAllAngles();
        
        this.updateMeasurements();
        this.render();
    }

    render() {
        // Clear the entire canvas
        this.ctx.clearRect(0, 0, this.canvas.width / this.dpi, this.canvas.height / this.dpi);
        
        // Draw grid
        this.drawGrid();

        // Draw all rooms with their measurements
        this.rooms.forEach((roomPoints, index) => {
            const isActiveRoom = index === this.activeRoomIndex;
            const roomOffset = this.roomOffsets[index];
            
            if (roomPoints.length > 0) {
                // Draw room shape
                this.ctx.beginPath();
                const startX = Math.floor((roomPoints[0].x + roomOffset.x) * this.scale) + 0.5;
                const startY = Math.floor((roomPoints[0].y + roomOffset.y) * this.scale) + 0.5;
                this.ctx.moveTo(startX, startY);

                for (let i = 1; i < roomPoints.length; i++) {
                    const x = Math.floor((roomPoints[i].x + roomOffset.x) * this.scale) + 0.5;
                    const y = Math.floor((roomPoints[i].y + roomOffset.y) * this.scale) + 0.5;
                    this.ctx.lineTo(x, y);
                }

                if (roomPoints.length > 2) {
                    this.ctx.closePath();
                }

                this.ctx.strokeStyle = isActiveRoom ? '#2563eb' : '#64748b';
                this.ctx.lineWidth = isActiveRoom ? 2 : 1;
                this.ctx.stroke();
                this.ctx.fillStyle = isActiveRoom ? '#2563eb20' : '#64748b20';
                this.ctx.fill();

                // Draw measurements for each room
                this.ctx.font = '14px Arial';
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                
                for (let i = 0; i < roomPoints.length; i++) {
                    const j = (i + 1) % roomPoints.length;
                    if (j === 0 && roomPoints.length < 3) continue;

                    const p1 = {
                        x: roomPoints[i].x + roomOffset.x,
                        y: roomPoints[i].y + roomOffset.y
                    };
                    const p2 = {
                        x: roomPoints[j].x + roomOffset.x,
                        y: roomPoints[j].y + roomOffset.y
                    };
                    
                    // Calculate midpoint with offset
                    const midX = Math.floor((p1.x + p2.x) / 2 * this.scale) + 0.5;
                    const midY = Math.floor((p1.y + p2.y) / 2 * this.scale) + 0.5;
                    
                    // Calculate angle of the line
                    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
                    let labelAngle = angle;
                    
                    // Calculate length using original points
                    const length = this.calculateSegmentLength(roomPoints[i], roomPoints[j]);
                    const text = length.toFixed(2) + 'm';
                    const metrics = this.ctx.measureText(text);
                    const textHeight = 14;
                    const padding = 4;
                    const offset = textHeight + padding;

                    if (angle > Math.PI/2 || angle < -Math.PI/2) {
                        labelAngle += Math.PI;
                    }

                    this.ctx.save();
                    this.ctx.translate(midX, midY);
                    
                    const perpAngle = angle - Math.PI/2;
                    const offsetX = Math.cos(perpAngle) * offset;
                    const offsetY = Math.sin(perpAngle) * offset;
                    
                    this.ctx.translate(offsetX, offsetY);
                    
                    if (Math.abs(angle) > Math.PI/2) {
                        this.ctx.rotate(labelAngle - Math.PI);
                    } else {
                        this.ctx.rotate(labelAngle);
                    }

                    this.ctx.fillStyle = isActiveRoom ? '#2563eb' : '#64748b';
                    this.ctx.fillText(text, 0, 0);
                    
                    this.ctx.restore();
                }
            }
        });

        // Draw points, measurements, etc. for active room only
        const activeOffset = this.roomOffsets[this.activeRoomIndex];

        // Draw points
        this.points.forEach((point, index) => {
            const x = Math.floor((point.x + activeOffset.x) * this.scale) + 0.5;
            const y = Math.floor((point.y + activeOffset.y) * this.scale) + 0.5;
            
            this.ctx.beginPath();
            this.ctx.arc(x, y, 4, 0, Math.PI * 2);
            this.ctx.fillStyle = index === this.selectedPointIndex ? '#dc2626' : '#2563eb';
            this.ctx.fill();
            this.ctx.strokeStyle = 'white';
            this.ctx.lineWidth = 1;
            this.ctx.stroke();
        });

        // Draw hover point
        if (this.hoverPoint && !this.isDragging) {
            const x = Math.floor(this.hoverPoint.x * this.scale) + 0.5;
            const y = Math.floor(this.hoverPoint.y * this.scale) + 0.5;
            
            this.ctx.beginPath();
            this.ctx.arc(x, y, 4, 0, Math.PI * 2);
            this.ctx.fillStyle = 'rgba(37, 99, 235, 0.5)';
            this.ctx.fill();
            this.ctx.strokeStyle = '#2563eb';
            this.ctx.lineWidth = 1;
            this.ctx.stroke();

            this.ctx.beginPath();
            this.ctx.moveTo(x - 6, y);
            this.ctx.lineTo(x + 6, y);
            this.ctx.moveTo(x, y - 6);
            this.ctx.lineTo(x, y + 6);
            this.ctx.strokeStyle = '#2563eb';
            this.ctx.lineWidth = 1;
            this.ctx.stroke();
        }

        // Optionally, visualize the bounding rectangle
        if (this.points.length >= 3) {
            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;

            this.points.forEach(point => {
                minX = Math.min(minX, point.x);
                minY = Math.min(minY, point.y);
                maxX = Math.max(maxX, point.x);
                maxY = Math.max(maxY, point.y);
            });

            // Draw bounding rectangle with dashed lines
            this.ctx.setLineDash([5, 5]);
            this.ctx.strokeStyle = '#dc2626';
            this.ctx.lineWidth = 1;
            this.ctx.beginPath();
            this.ctx.moveTo((minX + activeOffset.x) * this.scale, (minY + activeOffset.y) * this.scale);
            this.ctx.lineTo((maxX + activeOffset.x) * this.scale, (minY + activeOffset.y) * this.scale);
            this.ctx.lineTo((maxX + activeOffset.x) * this.scale, (maxY + activeOffset.y) * this.scale);
            this.ctx.lineTo((minX + activeOffset.x) * this.scale, (maxY + activeOffset.y) * this.scale);
            this.ctx.closePath();
            this.ctx.stroke();
            this.ctx.setLineDash([]); // Reset dash pattern
        }

        // Draw angle indicators for points with set angles
        this.roomAngles[this.activeRoomIndex].forEach((angle, index) => {
            const point = this.points[index];
            const x = (point.x + activeOffset.x) * this.scale;
            const y = (point.y + activeOffset.y) * this.scale;

            // Draw angle indicator
            this.ctx.beginPath();
            this.ctx.arc(x, y, 15, 0, 2 * Math.PI);
            this.ctx.strokeStyle = '#2563eb';
            this.ctx.setLineDash([2, 2]);
            this.ctx.stroke();
            this.ctx.setLineDash([]);

            // Draw angle text
            this.ctx.fillStyle = '#2563eb';
            this.ctx.font = '12px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText(`${angle}°`, x, y - 20);
        });

        // Draw room names for all rooms
        this.rooms.forEach((roomPoints, index) => {
            const roomName = this.roomNames[index];
            if (roomName && roomPoints.length >= 3) {
                let sumX = 0, sumY = 0;
                roomPoints.forEach(point => {
                    sumX += point.x;
                    sumY += point.y;
                });
                const center = {
                    x: (sumX / roomPoints.length + this.roomOffsets[index].x) * this.scale,
                    y: (sumY / roomPoints.length + this.roomOffsets[index].y) * this.scale
                };

                this.ctx.font = '14px Arial';
                this.ctx.fillStyle = index === this.activeRoomIndex ? '#2563eb' : '#64748b';
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillText(roomName, center.x, center.y);
            }
        });
    }

    drawGrid() {
        this.ctx.strokeStyle = '#eee';
        this.ctx.lineWidth = 1;

        // Draw vertical lines
        for (let x = 0; x < this.canvas.width; x += this.scale) {
            const px = Math.floor(x) + 0.5;
            this.ctx.beginPath();
            this.ctx.moveTo(px, 0);
            this.ctx.lineTo(px, this.canvas.height);
            this.ctx.stroke();
        }

        // Draw horizontal lines
        for (let y = 0; y < this.canvas.height; y += this.scale) {
            const py = Math.floor(y) + 0.5;
            this.ctx.beginPath();
            this.ctx.moveTo(0, py);
            this.ctx.lineTo(this.canvas.width, py);
            this.ctx.stroke();
        }
    }

    updateCursor(pos) {
        // Reset cursor state
        if (this.measurementInput) {
            this.canvas.style.cursor = 'text';
            return;
        }

        // Check for points and lines
        const nearPoint = this.points.some(point => {
            const dist = Math.hypot(
                ((point.x + this.roomOffsets[this.activeRoomIndex].x) * this.scale) - (pos.x * this.scale),
                ((point.y + this.roomOffsets[this.activeRoomIndex].y) * this.scale) - (pos.y * this.scale)
            );
            return dist < 15;
        });

        if (nearPoint) {
            this.canvas.style.cursor = 'pointer';
            return;
        }

        // Check for line hover
        if (this.hoverPoint) {
            this.canvas.style.cursor = 'pointer';
            return;
        }

        // Check for panning area
        if (this.isInPanningArea(pos)) {
            this.canvas.style.cursor = 'move';
            return;
        }

        this.canvas.style.cursor = 'default';
    }

    isInPanningArea(pos) {
        // Convert mouse position to scaled coordinates
        const scaledPos = {
            x: pos.x * this.scale,
            y: pos.y * this.scale
        };

        // Point in polygon check
        let inside = false;
        for (let i = 0, j = this.points.length - 1; i < this.points.length; j = i++) {
            const xi = (this.points[i].x + this.roomOffsets[this.activeRoomIndex].x) * this.scale;
            const yi = (this.points[i].y + this.roomOffsets[this.activeRoomIndex].y) * this.scale;
            const xj = (this.points[j].x + this.roomOffsets[this.activeRoomIndex].x) * this.scale;
            const yj = (this.points[j].y + this.roomOffsets[this.activeRoomIndex].y) * this.scale;

            const intersect = ((yi > scaledPos.y) !== (yj > scaledPos.y))
                && (scaledPos.x < (xj - xi) * (scaledPos.y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }

        // If not inside the polygon, return false
        if (!inside) return false;

        // Check if we're near any points or lines (buffer zone)
        const nearFeature = this.points.some((point, i) => {
            // Check distance to point
            const distToPoint = Math.hypot(
                ((point.x + this.roomOffsets[this.activeRoomIndex].x) * this.scale) - scaledPos.x,
                ((point.y + this.roomOffsets[this.activeRoomIndex].y) * this.scale) - scaledPos.y
            );
            
            if (distToPoint < 20) return true;

            // Check distance to line
            const next = this.points[(i + 1) % this.points.length];
            const closest = this.findClosestPointOnSegment(pos, point, next);
            const distToLine = Math.hypot(
                ((closest.x + this.roomOffsets[this.activeRoomIndex].x) * this.scale) - scaledPos.x,
                ((closest.y + this.roomOffsets[this.activeRoomIndex].y) * this.scale) - scaledPos.y
            );

            return distToLine < 20;
        });

        return inside && !nearFeature;
    }

    handleRightClick(e) {
        const pos = this.getMousePos(e);
        
        // First check if clicking near a point
        const pointIndex = this.points.findIndex(p => 
            Math.hypot(
                ((p.x + this.roomOffsets[this.activeRoomIndex].x) * this.scale) - (pos.x * this.scale),
                ((p.y + this.roomOffsets[this.activeRoomIndex].y) * this.scale) - (pos.y * this.scale)
            ) < 10
        );

        if (pointIndex !== -1) {
            this.showPointContextMenu(e, pointIndex);
            return;
        }

        // Then check if clicking inside the floor plan
        if (this.isInPanningArea(pos)) {
            this.showRoomContextMenu(e);
        }
    }

    showRoomContextMenu(e) {
        if (this.contextMenu) {
            this.contextMenu.remove();
        }

        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.style.cssText = `
            position: fixed;
            z-index: 1000;
            min-width: 160px;
            background: white;
            border-radius: 6px;
            box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1);
            border: 1px solid rgb(226 232 240);
            padding: 4px;
            font-family: system-ui, -apple-system, sans-serif;
            font-size: 14px;
        `;

        const currentRoomName = this.roomNames[this.activeRoomIndex] || '';

        const setNameItem = document.createElement('button');
        setNameItem.className = 'context-menu-item';
        setNameItem.style.cssText = `
            display: flex;
            align-items: center;
            width: 100%;
            padding: 8px 12px;
            border: none;
            background: none;
            cursor: pointer;
            text-align: left;
            border-radius: 4px;
        `;
        setNameItem.innerHTML = `
            <span style="flex-grow: 1">Set Room Name${currentRoomName ? ` (${currentRoomName})` : ''}</span>
        `;
        setNameItem.addEventListener('mouseenter', () => {
            setNameItem.style.backgroundColor = 'rgb(241 245 249)';
        });
        setNameItem.addEventListener('mouseleave', () => {
            setNameItem.style.backgroundColor = 'transparent';
        });
        setNameItem.addEventListener('click', () => {
            this.promptRoomName();
            menu.remove();
        });

        const clearNameItem = document.createElement('button');
        clearNameItem.className = 'context-menu-item';
        clearNameItem.style.cssText = setNameItem.style.cssText;
        clearNameItem.innerHTML = `
            <span style="flex-grow: 1">Clear Room Name</span>
        `;
        clearNameItem.addEventListener('mouseenter', () => {
            clearNameItem.style.backgroundColor = 'rgb(241 245 249)';
        });
        clearNameItem.addEventListener('mouseleave', () => {
            clearNameItem.style.backgroundColor = 'transparent';
        });
        clearNameItem.addEventListener('click', () => {
            this.roomNames[this.activeRoomIndex] = '';
            this.render();
            menu.remove();
        });

        menu.appendChild(setNameItem);
        if (currentRoomName) {
            menu.appendChild(clearNameItem);
        }

        menu.style.left = `${e.clientX}px`;
        menu.style.top = `${e.clientY}px`;

        document.body.appendChild(menu);
        this.contextMenu = menu;
    }

    promptRoomName() {
        const currentName = this.roomNames[this.activeRoomIndex] || '';
        const name = prompt('Enter room name:', currentName);
        if (name !== null) {
            this.roomNames[this.activeRoomIndex] = name.trim();
            this.render();
        }
    }

    calculateRoomCenter() {
        if (this.points.length < 3) return null;

        let sumX = 0, sumY = 0;
        this.points.forEach(point => {
            sumX += point.x;
            sumY += point.y;
        });

        return {
            x: sumX / this.points.length,
            y: sumY / this.points.length
        };
    }

    showPointContextMenu(e, pointIndex) {
        // Remove existing context menu if any
        if (this.contextMenu) {
            this.contextMenu.remove();
        }

        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.style.cssText = `
            position: fixed;
            z-index: 1000;
            min-width: 160px;
            background: white;
            border-radius: 6px;
            box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1);
            border: 1px solid rgb(226 232 240);
            padding: 4px;
            font-family: system-ui, -apple-system, sans-serif;
            font-size: 14px;
        `;

        const currentAngle = this.roomAngles[this.activeRoomIndex].get(pointIndex);
        
        // Create menu items
        const setAngleItem = document.createElement('button');
        setAngleItem.className = 'context-menu-item';
        setAngleItem.style.cssText = `
            display: flex;
            align-items: center;
            width: 100%;
            padding: 8px 12px;
            border: none;
            background: none;
            cursor: pointer;
            text-align: left;
            border-radius: 4px;
        `;
        setAngleItem.innerHTML = `
            <span style="flex-grow: 1">Set Angle${currentAngle ? ` (${currentAngle}°)` : ''}</span>
        `;
        setAngleItem.addEventListener('mouseenter', () => {
            setAngleItem.style.backgroundColor = 'rgb(241 245 249)';
        });
        setAngleItem.addEventListener('mouseleave', () => {
            setAngleItem.style.backgroundColor = 'transparent';
        });
        setAngleItem.addEventListener('click', () => {
            this.promptAngle(pointIndex);
            menu.remove();
        });

        const clearAngleItem = document.createElement('button');
        clearAngleItem.className = 'context-menu-item';
        clearAngleItem.style.cssText = setAngleItem.style.cssText;
        clearAngleItem.innerHTML = `
            <span style="flex-grow: 1">Clear Angle</span>
        `;
        clearAngleItem.addEventListener('mouseenter', () => {
            clearAngleItem.style.backgroundColor = 'rgb(241 245 249)';
        });
        clearAngleItem.addEventListener('mouseleave', () => {
            clearAngleItem.style.backgroundColor = 'transparent';
        });
        clearAngleItem.addEventListener('click', () => {
            this.roomAngles[this.activeRoomIndex].delete(pointIndex);
            this.adjustToAngles();
            this.render();
            menu.remove();
        });

        // Add delete point option
        const deletePointItem = document.createElement('button');
        deletePointItem.className = 'context-menu-item';
        deletePointItem.style.cssText = setAngleItem.style.cssText;
        // Add red color to the delete text
        deletePointItem.innerHTML = `
            <span style="flex-grow: 1; color: #dc2626">Delete Point</span>
        `;
        deletePointItem.addEventListener('mouseenter', () => {
            deletePointItem.style.backgroundColor = 'rgb(254 242 242)';
        });
        deletePointItem.addEventListener('mouseleave', () => {
            deletePointItem.style.backgroundColor = 'transparent';
        });
        deletePointItem.addEventListener('click', () => {
            this.deletePoint(pointIndex);
            menu.remove();
        });

        // Add separator before delete option
        const separator = document.createElement('div');
        separator.style.cssText = `
            height: 1px;
            background-color: rgb(226 232 240);
            margin: 4px 0;
        `;

        // Add clear fixed lengths option
        const clearLengthsItem = document.createElement('button');
        clearLengthsItem.className = 'context-menu-item';
        clearLengthsItem.style.cssText = setAngleItem.style.cssText;
        clearLengthsItem.innerHTML = `
            <span style="flex-grow: 1">Clear Fixed Lengths</span>
        `;
        clearLengthsItem.addEventListener('mouseenter', () => {
            clearLengthsItem.style.backgroundColor = 'rgb(241 245 249)';
        });
        clearLengthsItem.addEventListener('mouseleave', () => {
            clearLengthsItem.style.backgroundColor = 'transparent';
        });
        clearLengthsItem.addEventListener('click', () => {
            const numPoints = this.points.length;
            const prevIndex = (pointIndex - 1 + numPoints) % numPoints;
            const nextIndex = (pointIndex + 1) % numPoints;
            
            // Clear fixed lengths for segments connected to this point
            this.roomFixedLengths[this.activeRoomIndex].delete(`${prevIndex}-${pointIndex}`);
            this.roomFixedLengths[this.activeRoomIndex].delete(`${pointIndex}-${prevIndex}`);
            this.roomFixedLengths[this.activeRoomIndex].delete(`${pointIndex}-${nextIndex}`);
            this.roomFixedLengths[this.activeRoomIndex].delete(`${nextIndex}-${pointIndex}`);
            
            this.render();
            menu.remove();
        });

        menu.appendChild(setAngleItem);
        if (currentAngle !== undefined) {
            menu.appendChild(clearAngleItem);
        }
        
        // Only show delete option if we have more than 3 points
        if (this.points.length > 3) {
            menu.appendChild(separator.cloneNode());
            menu.appendChild(deletePointItem);
        }

        // Add the clear lengths option to the menu
        menu.appendChild(separator.cloneNode());
        menu.appendChild(clearLengthsItem);

        // Position menu
        menu.style.left = `${e.clientX}px`;
        menu.style.top = `${e.clientY}px`;

        // Add to document
        document.body.appendChild(menu);
        this.contextMenu = menu;
    }

    promptAngle(pointIndex) {
        const currentAngle = this.roomAngles[this.activeRoomIndex].get(pointIndex) || 
                           this.calculateCurrentAngle(pointIndex);
        const angle = prompt('Enter angle in degrees:', currentAngle.toFixed(1));
        
        if (angle !== null) {
            const angleNum = parseFloat(angle);
            if (!isNaN(angleNum) && angleNum >= 0 && angleNum <= 360) {
                this.roomAngles[this.activeRoomIndex].set(pointIndex, angleNum);
                this.enforceAllAngles();
                this.render();
            } else {
                alert('Please enter a valid angle between 0 and 360 degrees');
            }
        }
    }

    calculateCurrentAngle(pointIndex) {
        const numPoints = this.points.length;
        // Get previous point (wrap around to last point if needed)
        const prev = this.points[(pointIndex - 1 + numPoints) % numPoints];
        const current = this.points[pointIndex];
        // Get next point (wrap around to first point if needed)
        const next = this.points[(pointIndex + 1) % numPoints];

        const v1 = {
            x: prev.x - current.x,
            y: prev.y - current.y
        };
        const v2 = {
            x: next.x - current.x,
            y: next.y - current.y
        };

        return this.calculateVectorAngle(v1, v2);
    }

    calculateVectorAngle(v1, v2) {
        // Calculate angle between two vectors
        const dot = v1.x * v2.x + v1.y * v2.y;
        const det = v1.x * v2.y - v1.y * v2.x;
        let angle = Math.atan2(det, dot) * 180 / Math.PI;
        
        // Ensure angle is positive
        if (angle < 0) {
            angle += 360;
        }
        
        // Return the actual angle (removed the 180 - angle conversion)
        return angle;
    }

    rotateVector(v, angleDegrees) {
        const angleRadians = angleDegrees * Math.PI / 180;
        return {
            x: v.x * Math.cos(angleRadians) - v.y * Math.sin(angleRadians),
            y: v.x * Math.sin(angleRadians) + v.y * Math.cos(angleRadians)
        };
    }

    adjustToAngles() {
        this.roomAngles[this.activeRoomIndex].forEach((targetAngle, pointIndex) => {
            const numPoints = this.points.length;
            const prev = this.points[(pointIndex - 1 + numPoints) % numPoints];
            const current = this.points[pointIndex];
            const next = this.points[(pointIndex + 1) % numPoints];

            // Calculate vectors
            const v1 = {
                x: prev.x - current.x,
                y: prev.y - current.y
            };
            const v2 = {
                x: next.x - current.x,
                y: next.y - current.y
            };

            // Calculate current angle between vectors
            const currentAngle = this.calculateVectorAngle(v1, v2);
            
            // Calculate how much we need to rotate
            const angleToRotate = targetAngle - currentAngle;
            
            // Rotate the next point to achieve desired angle
            const rotatedVector = this.rotateVector(v2, angleToRotate);
            
            // Update next point position
            this.points[(pointIndex + 1) % numPoints] = {
                x: current.x + rotatedVector.x,
                y: current.y + rotatedVector.y
            };
        });
    }

    // Add new method to handle point deletion
    deletePoint(pointIndex) {
        if (this.points.length <= 3) {
            alert('Cannot delete point: minimum of 3 points required');
            return;
        }

        // Remove the point
        this.points.splice(pointIndex, 1);
        
        // Remove any associated angle
        this.roomAngles[this.activeRoomIndex].delete(pointIndex);
        
        // Adjust indices in pointAngles map for points after the deleted point
        const newAngles = new Map();
        this.roomAngles[this.activeRoomIndex].forEach((angle, index) => {
            if (index < pointIndex) {
                newAngles.set(index, angle);
            } else if (index > pointIndex) {
                newAngles.set(index - 1, angle);
            }
        });
        this.roomAngles[this.activeRoomIndex] = newAngles;

        // Update measurements and render
        this.updateMeasurements();
        this.render();
    }

    addNewRoom() {
        // Calculate offset for new room based on canvas center
        const canvasCenter = {
            x: (this.canvas.width / this.dpi / this.scale / 2),
            y: (this.canvas.height / this.dpi / this.scale / 2)
        };

        // Create a 1x1 square room offset from center
        const newRoom = [
            { x: -0.5, y: -0.5 },
            { x: 0.5, y: -0.5 },
            { x: 0.5, y: 0.5 },
            { x: -0.5, y: 0.5 }
        ];

        // Add the new room to the rooms array
        this.rooms.push(newRoom);
        // Add new offset for this room
        this.roomOffsets.push({ 
            x: canvasCenter.x / this.scale,
            y: canvasCenter.y / this.scale
        });
        
        // Switch to the new room
        this.activeRoomIndex = this.rooms.length - 1;
        this.points = this.rooms[this.activeRoomIndex];
        
        // Add new angle map for the new room
        this.roomAngles.push(new Map());
        
        // Add new fixed lengths map for the new room
        this.roomFixedLengths.push(new Map());
        
        // Update the display
        this.updateMeasurements();
        this.render();
    }

    isPointInRoom(pos, roomPoints, roomIndex) {
        const roomOffset = this.roomOffsets[roomIndex];
        let inside = false;
        for (let i = 0, j = roomPoints.length - 1; i < roomPoints.length; j = i++) {
            const xi = (roomPoints[i].x + roomOffset.x) * this.scale;
            const yi = (roomPoints[i].y + roomOffset.y) * this.scale;
            const xj = (roomPoints[j].x + roomOffset.x) * this.scale;
            const yj = (roomPoints[j].y + roomOffset.y) * this.scale;

            const intersect = ((yi > pos.y * this.scale) !== (yj > pos.y * this.scale))
                && (pos.x * this.scale < (xj - xi) * (pos.y * this.scale - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    enforceFixedLengths(movedPointIndex) {
        const fixedLengths = this.roomFixedLengths[this.activeRoomIndex];
        let iterations = 0;
        const maxIterations = 10;
        let lengthFixed;

        do {
            lengthFixed = false;
            
            // Check all segments connected to the moved point
            const numPoints = this.points.length;
            const prevIndex = (movedPointIndex - 1 + numPoints) % numPoints;
            const nextIndex = (movedPointIndex + 1) % numPoints;

            // Check and adjust previous segment
            const prevKey = `${prevIndex}-${movedPointIndex}`;
            const prevKeyReverse = `${movedPointIndex}-${prevIndex}`;
            const prevFixedLength = fixedLengths.get(prevKey) || fixedLengths.get(prevKeyReverse);
            
            if (prevFixedLength !== undefined) {
                const currentLength = this.calculateSegmentLength(
                    this.points[prevIndex],
                    this.points[movedPointIndex]
                );
                
                if (Math.abs(currentLength - prevFixedLength) > 0.01) {
                    lengthFixed = true;
                    this.adjustSegmentLength(prevIndex, movedPointIndex, prevFixedLength);
                }
            }

            // Check and adjust next segment
            const nextKey = `${movedPointIndex}-${nextIndex}`;
            const nextKeyReverse = `${nextIndex}-${movedPointIndex}`;
            const nextFixedLength = fixedLengths.get(nextKey) || fixedLengths.get(nextKeyReverse);
            
            if (nextFixedLength !== undefined) {
                const currentLength = this.calculateSegmentLength(
                    this.points[movedPointIndex],
                    this.points[nextIndex]
                );
                
                if (Math.abs(currentLength - nextFixedLength) > 0.01) {
                    lengthFixed = true;
                    this.adjustSegmentLength(movedPointIndex, nextIndex, nextFixedLength);
                }
            }

            iterations++;
        } while (lengthFixed && iterations < maxIterations);
    }

    areFixedLengthsValid() {
        const fixedLengths = this.roomFixedLengths[this.activeRoomIndex];
        
        for (const [key, targetLength] of fixedLengths.entries()) {
            const [index1, index2] = key.split('-').map(Number);
            const currentLength = this.calculateSegmentLength(
                this.points[index1],
                this.points[index2]
            );
            
            if (Math.abs(currentLength - targetLength) > 0.01) {
                return false;
            }
        }
        
        return true;
    }
}

export { RoomEditor };