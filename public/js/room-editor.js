class RoomEditor {
    constructor(canvasId, measurementsId) {
        this.points = [];
        this.isDragging = false;
        this.selectedPointIndex = null;
        this.scale = 100; // 100 pixels = 1 meter
        this.dpi = window.devicePixelRatio || 1;
        this.isPanning = false;
        this.panStart = null;
        this.roomOffset = { x: 0, y: 0 };
        this.hoverPoint = null;
        this.hoverSegmentIndex = null;
        this.measurementInput = null;
        this.pointAngles = new Map(); // Store angles for points
        this.contextMenu = null;
        this.roomName = '';

        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d', { alpha: false });
        this.measurements = document.getElementById(measurementsId);

        // Initialize with 1x1 square
        this.initializeSquare();
        
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
        // Create a 1x1 meter square
        this.points = [
            { x: 1, y: 1 }, // Top-right
            { x: 2, y: 1 }, // Top-left
            { x: 2, y: 2 }, // Bottom-left
            { x: 1, y: 2 }  // Bottom-right
        ];
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
            x: pos.x - this.roomOffset.x,
            y: pos.y - this.roomOffset.y
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
            this.roomOffset.x += dx;
            this.roomOffset.y += dy;
            this.panStart = { x: e.clientX, y: e.clientY };
            this.render();
            return;
        }

        if (this.isDragging && this.selectedPointIndex !== null) {
            // Update point position
            this.points[this.selectedPointIndex] = {
                x: pos.x - this.roomOffset.x,
                y: pos.y - this.roomOffset.y
            };

            // Enforce all angle constraints after point movement
            this.enforceAllAngles(this.selectedPointIndex);
            
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
                    x: closest.x + this.roomOffset.x,
                    y: closest.y + this.roomOffset.y
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

    enforceAllAngles(movedPointIndex) {
        let iterations = 0;
        const maxIterations = 5; // Prevent infinite loops
        let angleFixed;

        do {
            angleFixed = false;
            this.pointAngles.forEach((targetAngle, pointIndex) => {
                if (pointIndex === 0 || pointIndex >= this.points.length - 1) return;

                const prev = this.points[pointIndex - 1];
                const current = this.points[pointIndex];
                const next = this.points[pointIndex + 1];

                // Calculate current angle
                const angle1 = Math.atan2(current.y - prev.y, current.x - prev.x);
                const angle2 = Math.atan2(next.y - current.y, next.x - current.x);
                let currentAngle = ((angle2 - angle1) * 180 / Math.PI + 360) % 360;

                // If angle is significantly different from target, adjust it
                if (Math.abs(currentAngle - targetAngle) > 0.1) {
                    angleFixed = true;

                    // Determine which point to move based on which was dragged
                    if (movedPointIndex === pointIndex - 1) {
                        // Previous point was moved, adjust next point
                        this.rotatePointAroundCenter(current, next, targetAngle - currentAngle);
                    } else if (movedPointIndex === pointIndex + 1) {
                        // Next point was moved, adjust previous point
                        this.rotatePointAroundCenter(current, prev, currentAngle - targetAngle);
                    } else {
                        // Current point or other point was moved, adjust next point
                        this.rotatePointAroundCenter(current, next, targetAngle - currentAngle);
                    }
                }
            });
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
        
        // Check if we're clicking a measurement first
        if (this.checkMeasurementClick(pos)) {
            return;
        }

        // Check if clicking near existing point
        const pointIndex = this.points.findIndex(p => 
            Math.hypot(
                ((p.x + this.roomOffset.x) * this.scale) - (pos.x * this.scale),
                ((p.y + this.roomOffset.y) * this.scale) - (pos.y * this.scale)
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
                x: this.hoverPoint.x - this.roomOffset.x,
                y: this.hoverPoint.y - this.roomOffset.y
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
                x: (this.points[i].x + this.roomOffset.x) * this.scale,
                y: (this.points[i].y + this.roomOffset.y) * this.scale
            };
            const p2 = {
                x: (this.points[j].x + this.roomOffset.x) * this.scale,
                y: (this.points[j].y + this.roomOffset.y) * this.scale
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
            this.enforceAllAngles(this.selectedPointIndex);
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
        const midX = ((p1.x + p2.x) / 2 + this.roomOffset.x) * this.scale;
        const midY = ((p1.y + p2.y) / 2 + this.roomOffset.y) * this.scale;
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
        this.enforceAllAngles(index2);
        
        this.updateMeasurements();
        this.render();
    }

    render() {
        // Clear the entire canvas
        this.ctx.clearRect(0, 0, this.canvas.width / this.dpi, this.canvas.height / this.dpi);
        
        // Draw grid (fixed)
        this.drawGrid();

        // Draw room shape
        if (this.points.length > 0) {
            this.ctx.beginPath();
            const startX = Math.floor((this.points[0].x + this.roomOffset.x) * this.scale) + 0.5;
            const startY = Math.floor((this.points[0].y + this.roomOffset.y) * this.scale) + 0.5;
            this.ctx.moveTo(startX, startY);

            for (let i = 1; i < this.points.length; i++) {
                const x = Math.floor((this.points[i].x + this.roomOffset.x) * this.scale) + 0.5;
                const y = Math.floor((this.points[i].y + this.roomOffset.y) * this.scale) + 0.5;
                this.ctx.lineTo(x, y);
            }

            if (this.points.length > 2) {
                this.ctx.closePath();
            }

            this.ctx.strokeStyle = '#2563eb';
            this.ctx.lineWidth = 2;
            this.ctx.stroke();
            this.ctx.fillStyle = '#2563eb20';
            this.ctx.fill();
        }

        // Draw measurements
        this.ctx.font = '14px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        
        for (let i = 0; i < this.points.length; i++) {
            const j = (i + 1) % this.points.length;
            if (j === 0 && this.points.length < 3) continue;

            const p1 = {
                x: this.points[i].x + this.roomOffset.x,
                y: this.points[i].y + this.roomOffset.y
            };
            const p2 = {
                x: this.points[j].x + this.roomOffset.x,
                y: this.points[j].y + this.roomOffset.y
            };
            
            // Calculate midpoint with offset
            const midX = Math.floor((p1.x + p2.x) / 2 * this.scale) + 0.5;
            const midY = Math.floor((p1.y + p2.y) / 2 * this.scale) + 0.5;
            
            // Calculate angle of the line
            const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
            let labelAngle = angle;
            
            // Calculate length using original points (without offset)
            const length = this.calculateSegmentLength(this.points[i], this.points[j]);
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

            this.ctx.fillStyle = 'white';
            this.ctx.fillRect(
                -metrics.width/2 - padding,
                -textHeight/2 - padding,
                metrics.width + padding * 2,
                textHeight + padding * 2
            );
            
            this.ctx.fillStyle = '#000';
            this.ctx.fillText(text, 0, 0);
            
            this.ctx.restore();
        }

        // Draw points
        this.points.forEach((point, index) => {
            const x = Math.floor((point.x + this.roomOffset.x) * this.scale) + 0.5;
            const y = Math.floor((point.y + this.roomOffset.y) * this.scale) + 0.5;
            
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
            this.ctx.moveTo((minX + this.roomOffset.x) * this.scale, (minY + this.roomOffset.y) * this.scale);
            this.ctx.lineTo((maxX + this.roomOffset.x) * this.scale, (minY + this.roomOffset.y) * this.scale);
            this.ctx.lineTo((maxX + this.roomOffset.x) * this.scale, (maxY + this.roomOffset.y) * this.scale);
            this.ctx.lineTo((minX + this.roomOffset.x) * this.scale, (maxY + this.roomOffset.y) * this.scale);
            this.ctx.closePath();
            this.ctx.stroke();
            this.ctx.setLineDash([]); // Reset dash pattern
        }

        // Draw angle indicators for points with set angles
        this.pointAngles.forEach((angle, index) => {
            const point = this.points[index];
            const x = (point.x + this.roomOffset.x) * this.scale;
            const y = (point.y + this.roomOffset.y) * this.scale;

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

        // Draw room name if set
        if (this.roomName && this.points.length >= 3) {
            const center = this.calculateRoomCenter();
            if (center) {
                const x = (center.x + this.roomOffset.x) * this.scale;
                const y = (center.y + this.roomOffset.y) * this.scale;

                // Use same font as measurements
                this.ctx.font = '14px Arial';
                this.ctx.fillStyle = '#2563eb';
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillText(this.roomName, x, y);
            }
        }
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
                ((point.x + this.roomOffset.x) * this.scale) - (pos.x * this.scale),
                ((point.y + this.roomOffset.y) * this.scale) - (pos.y * this.scale)
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
            const xi = (this.points[i].x + this.roomOffset.x) * this.scale;
            const yi = (this.points[i].y + this.roomOffset.y) * this.scale;
            const xj = (this.points[j].x + this.roomOffset.x) * this.scale;
            const yj = (this.points[j].y + this.roomOffset.y) * this.scale;

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
                ((point.x + this.roomOffset.x) * this.scale) - scaledPos.x,
                ((point.y + this.roomOffset.y) * this.scale) - scaledPos.y
            );
            
            if (distToPoint < 20) return true;

            // Check distance to line
            const next = this.points[(i + 1) % this.points.length];
            const closest = this.findClosestPointOnSegment(pos, point, next);
            const distToLine = Math.hypot(
                ((closest.x + this.roomOffset.x) * this.scale) - scaledPos.x,
                ((closest.y + this.roomOffset.y) * this.scale) - scaledPos.y
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
                ((p.x + this.roomOffset.x) * this.scale) - (pos.x * this.scale),
                ((p.y + this.roomOffset.y) * this.scale) - (pos.y * this.scale)
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
            <span style="flex-grow: 1">Set Room Name${this.roomName ? ` (${this.roomName})` : ''}</span>
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
            this.roomName = '';
            this.render();
            menu.remove();
        });

        menu.appendChild(setNameItem);
        if (this.roomName) {
            menu.appendChild(clearNameItem);
        }

        // Position menu
        menu.style.left = `${e.clientX}px`;
        menu.style.top = `${e.clientY}px`;

        // Add to document
        document.body.appendChild(menu);
        this.contextMenu = menu;
    }

    promptRoomName() {
        const name = prompt('Enter room name:', this.roomName);
        if (name !== null) {
            this.roomName = name.trim();
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

        const currentAngle = this.pointAngles.get(pointIndex);
        
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
            this.pointAngles.delete(pointIndex);
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

        menu.appendChild(setAngleItem);
        if (currentAngle !== undefined) {
            menu.appendChild(clearAngleItem);
        }
        
        // Only show delete option if we have more than 3 points
        if (this.points.length > 3) {
            menu.appendChild(separator);
            menu.appendChild(deletePointItem);
        }

        // Position menu
        menu.style.left = `${e.clientX}px`;
        menu.style.top = `${e.clientY}px`;

        // Add to document
        document.body.appendChild(menu);
        this.contextMenu = menu;
    }

    promptAngle(pointIndex) {
        if (pointIndex === 0 || pointIndex >= this.points.length - 1) {
            alert('Cannot set angle for first or last point');
            return;
        }

        const currentAngle = this.pointAngles.get(pointIndex) || this.calculateCurrentAngle(pointIndex);
        const angle = prompt('Enter angle in degrees:', currentAngle.toFixed(1));
        
        if (angle !== null) {
            const angleNum = parseFloat(angle);
            if (!isNaN(angleNum) && angleNum > 0 && angleNum < 180) {
                this.pointAngles.set(pointIndex, angleNum);
                this.adjustToAngles();
                this.render();
            } else {
                alert('Please enter a valid angle between 0 and 180 degrees');
            }
        }
    }

    calculateCurrentAngle(pointIndex) {
        if (pointIndex === 0 || pointIndex >= this.points.length - 1) return 0;

        const prev = this.points[pointIndex - 1];
        const current = this.points[pointIndex];
        const next = this.points[pointIndex + 1];

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
        
        // Convert to interior angle
        return 180 - angle;
    }

    rotateVector(v, angleDegrees) {
        const angleRadians = angleDegrees * Math.PI / 180;
        return {
            x: v.x * Math.cos(angleRadians) - v.y * Math.sin(angleRadians),
            y: v.x * Math.sin(angleRadians) + v.y * Math.cos(angleRadians)
        };
    }

    adjustToAngles() {
        this.pointAngles.forEach((targetAngle, pointIndex) => {
            if (pointIndex === 0 || pointIndex >= this.points.length - 1) return;

            const prev = this.points[pointIndex - 1];
            const current = this.points[pointIndex];
            const next = this.points[pointIndex + 1];

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
            this.points[pointIndex + 1] = {
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
        this.pointAngles.delete(pointIndex);
        
        // Adjust indices in pointAngles map for points after the deleted point
        const newAngles = new Map();
        this.pointAngles.forEach((angle, index) => {
            if (index < pointIndex) {
                newAngles.set(index, angle);
            } else if (index > pointIndex) {
                newAngles.set(index - 1, angle);
            }
        });
        this.pointAngles = newAngles;

        // Update measurements and render
        this.updateMeasurements();
        this.render();
    }
}

export { RoomEditor };