/**
 * Interactive SVG Altitude Profile Chart
 * Renders flight altitude profiles with standard SVG, eliminating the need
 * for bloated third-party charting libraries. Updates dynamically when scrubbed.
 */

class AltitudeChart {
    /**
     * @param {HTMLElement} container - The container element to mount the chart
     * @param {Object} options - Configuration options
     * @param {Function} options.onHover - Callback when user scrubs over chart: (point) => {}
     * @param {Function} options.onHoverEnd - Callback when user leaves chart area
     */
    constructor(container, options = {}) {
        this.container = container;
        this.onHover = options.onHover || null;
        this.onHoverEnd = options.onHoverEnd || null;
        
        this.points = [];
        this.svg = null;
        this.padding = { top: 15, right: 10, bottom: 20, left: 45 };
        
        // Bind event handlers
        this._handleMouseMove = this._handleMouseMove.bind(this);
        this._handleMouseLeave = this._handleMouseLeave.bind(this);
        this._handleResize = this._handleResize.bind(this);
        
        window.addEventListener('resize', this._handleResize);
    }

    /**
     * Clean up event listeners
     */
    destroy() {
        window.removeEventListener('resize', this._handleResize);
        if (this.svg) {
            this.svg.removeEventListener('mousemove', this._handleMouseMove);
            this.svg.removeEventListener('mouseleave', this._handleMouseLeave);
        }
    }

    /**
     * Renders a flight profile on the chart
     * @param {Array<Object>} points - The parsed track B-record points
     */
    setData(points) {
        this.points = points || [];
        this._render();
    }

    _handleResize() {
        if (this.points.length > 0) {
            this._render();
        }
    }

    /**
     * Renders the chart using raw SVG elements
     */
    _render() {
        this.container.innerHTML = '';
        if (this.points.length === 0) return;

        const width = this.container.clientWidth || 300;
        const height = 150; // Fixed visual height

        // Find ranges
        const times = this.points.map(p => p.timeSec);
        const alts = this.points.map(p => p.alt);
        
        const minTime = Math.min(...times);
        const maxTime = Math.max(...times);
        const timeRange = maxTime - minTime || 1;

        let minAlt = Math.min(...alts);
        const maxAlt = Math.max(...alts);
        
        // Add a bit of padding to the altitude scale
        minAlt = Math.max(0, minAlt - (maxAlt - minAlt) * 0.1);
        const altRange = maxAlt - minAlt || 1;

        this.scale = {
            minTime,
            maxTime,
            timeRange,
            minAlt,
            maxAlt,
            altRange,
            width,
            height,
            plotWidth: width - this.padding.left - this.padding.right,
            plotHeight: height - this.padding.top - this.padding.bottom
        };

        // Create the SVG container
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', height);
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        svg.style.overflow = 'visible';
        svg.style.cursor = 'crosshair';
        
        // Create SVG gradients and filters
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        defs.innerHTML = `
            <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="var(--color-primary, #6366f1)" stop-opacity="0.4"/>
                <stop offset="100%" stop-color="var(--color-primary, #6366f1)" stop-opacity="0.0"/>
            </linearGradient>
        `;
        svg.appendChild(defs);

        // Draw grid lines and Y-axis ticks
        const gridGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        gridGroup.setAttribute('stroke', 'var(--chart-grid, #cbd5e1)');
        gridGroup.setAttribute('stroke-width', '1');
        gridGroup.setAttribute('stroke-dasharray', '3 3');
        gridGroup.setAttribute('opacity', '0.6');

        const labelGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        labelGroup.setAttribute('fill', 'var(--color-text-muted, #64748b)');
        labelGroup.setAttribute('font-size', '10');
        labelGroup.setAttribute('font-family', 'Inter, sans-serif');

        // Y-ticks: 3 horizontal ticks
        const yTicks = 3;
        for (let i = 0; i < yTicks; i++) {
            const ratio = i / (yTicks - 1);
            const altValue = Math.round(maxAlt - ratio * (maxAlt - minAlt));
            const y = this.padding.top + ratio * this.scale.plotHeight;

            // Grid line
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', this.padding.left);
            line.setAttribute('y1', y);
            line.setAttribute('x2', width - this.padding.right);
            line.setAttribute('y2', y);
            gridGroup.appendChild(line);

            // Label
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', this.padding.left - 8);
            text.setAttribute('y', y + 3.5);
            text.setAttribute('text-anchor', 'end');
            text.textContent = `${altValue}m`;
            labelGroup.appendChild(text);
        }

        // X-ticks: start and end time
        const xTimes = [minTime, maxTime];
        xTimes.forEach((tVal, idx) => {
            const x = this.padding.left + (idx * this.scale.plotWidth);
            const h = Math.floor(tVal / 3600) % 24;
            const m = Math.floor((tVal % 3600) / 60);
            const timeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;

            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', x);
            text.setAttribute('y', height - 4);
            text.setAttribute('text-anchor', idx === 0 ? 'start' : 'end');
            text.textContent = timeStr;
            labelGroup.appendChild(text);
        });

        svg.appendChild(gridGroup);
        svg.appendChild(labelGroup);

        // Generate coordinates for paths
        const coords = this.points.map(p => {
            const x = this.padding.left + ((p.timeSec - minTime) / timeRange) * this.scale.plotWidth;
            const y = this.padding.top + (1 - (p.alt - minAlt) / altRange) * this.scale.plotHeight;
            return { x, y };
        });

        // Draw filled area path
        let areaD = `M ${coords[0].x} ${this.padding.top + this.scale.plotHeight}`;
        coords.forEach(c => {
            areaD += ` L ${c.x} ${c.y}`;
        });
        areaD += ` L ${coords[coords.length - 1].x} ${this.padding.top + this.scale.plotHeight} Z`;

        const areaPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        areaPath.setAttribute('d', areaD);
        areaPath.setAttribute('fill', 'url(#chartGradient)');
        svg.appendChild(areaPath);

        // Draw line path
        let lineD = `M ${coords[0].x} ${coords[0].y}`;
        for (let i = 1; i < coords.length; i++) {
            lineD += ` L ${coords[i].x} ${coords[i].y}`;
        }

        const linePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        linePath.setAttribute('d', lineD);
        linePath.setAttribute('fill', 'none');
        linePath.setAttribute('stroke', 'var(--color-primary, #6366f1)');
        linePath.setAttribute('stroke-width', '2.5');
        linePath.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(linePath);

        // Interactive elements (hidden by default)
        const interactiveGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        interactiveGroup.setAttribute('id', 'chart-interactive');
        interactiveGroup.style.display = 'none';

        // Vertical tracker line
        const trackerLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        trackerLine.setAttribute('x1', '0');
        trackerLine.setAttribute('y1', this.padding.top);
        trackerLine.setAttribute('x2', '0');
        trackerLine.setAttribute('y2', height - this.padding.bottom);
        trackerLine.setAttribute('stroke', 'var(--color-secondary, #10b981)');
        trackerLine.setAttribute('stroke-width', '1.5');
        trackerLine.setAttribute('stroke-dasharray', '2 2');
        interactiveGroup.appendChild(trackerLine);

        // Highlight point on the line
        const trackerDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        trackerDot.setAttribute('r', '5');
        trackerDot.setAttribute('fill', 'var(--color-secondary, #10b981)');
        trackerDot.setAttribute('stroke', '#ffffff');
        trackerDot.setAttribute('stroke-width', '1.5');
        interactiveGroup.appendChild(trackerDot);

        // Tooltip box
        const tooltipGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        
        const tooltipRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        tooltipRect.setAttribute('rx', '4');
        tooltipRect.setAttribute('fill', 'var(--color-tooltip-bg, rgba(15, 23, 42, 0.95))');
        tooltipRect.setAttribute('stroke', 'var(--border-color, #cbd5e1)');
        tooltipRect.setAttribute('stroke-width', '1');
        tooltipRect.setAttribute('filter', 'drop-shadow(0 4px 6px rgba(0, 0, 0, 0.15))');
        
        const tooltipText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        tooltipText.setAttribute('fill', 'var(--color-tooltip-text, #ffffff)');
        tooltipText.setAttribute('font-size', '10');
        tooltipText.setAttribute('font-family', 'Inter, sans-serif');
        tooltipText.setAttribute('y', '15');
        tooltipText.setAttribute('x', '6');
        
        tooltipGroup.appendChild(tooltipRect);
        tooltipGroup.appendChild(tooltipText);
        interactiveGroup.appendChild(tooltipGroup);

        svg.appendChild(interactiveGroup);

        // Save references
        this.svg = svg;
        this.trackerLine = trackerLine;
        this.trackerDot = trackerDot;
        this.tooltipGroup = tooltipGroup;
        this.tooltipRect = tooltipRect;
        this.tooltipText = tooltipText;
        this.interactiveGroup = interactiveGroup;

        // Attach listeners
        svg.addEventListener('mousemove', this._handleMouseMove);
        svg.addEventListener('mouseleave', this._handleMouseLeave);

        this.container.appendChild(svg);
    }

    /**
     * Handle mouse move over the chart to scrub through flight points
     */
    _handleMouseMove(e) {
        if (!this.svg || this.points.length === 0 || !this.scale) return;

        const rect = this.svg.getBoundingClientRect();
        const clientX = e.clientX - rect.left;
        
        // Calculate coordinate mapping inside the plot area
        const xPos = clientX - this.padding.left;
        let pct = xPos / this.scale.plotWidth;
        
        if (pct < 0) pct = 0;
        if (pct > 1) pct = 1;

        // Find the index in our array closest to the cursor percentage
        const index = Math.min(
            this.points.length - 1,
            Math.max(0, Math.floor(pct * (this.points.length - 1)))
        );

        const pt = this.points[index];
        if (!pt) return;

        // Calculate visual X and Y coords on the SVG
        const xVal = this.padding.left + ((pt.timeSec - this.scale.minTime) / this.scale.timeRange) * this.scale.plotWidth;
        const yVal = this.padding.top + (1 - (pt.alt - this.scale.minAlt) / this.scale.altRange) * this.scale.plotHeight;

        // Display interactive elements
        this.interactiveGroup.style.display = 'block';

        // Update indicator line and dot
        this.trackerLine.setAttribute('x1', xVal);
        this.trackerLine.setAttribute('x2', xVal);
        this.trackerDot.setAttribute('cx', xVal);
        this.trackerDot.setAttribute('cy', yVal);

        // Update tooltip content
        const elapsedSec = pt.timeSec - this.scale.minTime;
        const elapsedMin = Math.floor(elapsedSec / 60);
        const elapsedSecRemainder = elapsedSec % 60;
        const elapsedStr = `${elapsedMin}m ${elapsedSecRemainder}s`;

        this.tooltipText.innerHTML = `
            <tspan x="6" dy="0" font-weight="bold">${pt.alt} m</tspan>
            <tspan x="6" dy="13" fill="var(--color-text-dim, #94a3b8)">Time: ${pt.timeStr}</tspan>
            <tspan x="6" dy="13" fill="var(--color-text-dim, #94a3b8)">Elapsed: ${elapsedStr}</tspan>
        `;

        // Resize tooltip background rect to match content
        const bbox = this.tooltipText.getBBox();
        const tooltipW = bbox.width + 12;
        const tooltipH = bbox.height + 8;
        this.tooltipRect.setAttribute('width', tooltipW);
        this.tooltipRect.setAttribute('height', tooltipH);

        // Position tooltip box so it doesn't clip outside chart edges
        let tooltipX = xVal + 10;
        if (tooltipX + tooltipW > this.scale.width) {
            tooltipX = xVal - tooltipW - 10;
        }
        let tooltipY = yVal - tooltipH / 2;
        if (tooltipY < this.padding.top) {
            tooltipY = this.padding.top;
        } else if (tooltipY + tooltipH > this.scale.height - this.padding.bottom) {
            tooltipY = this.scale.height - this.padding.bottom - tooltipH;
        }

        this.tooltipGroup.setAttribute('transform', `translate(${tooltipX}, ${tooltipY})`);

        // Trigger map synchronization callback
        if (this.onHover) {
            this.onHover(pt, index);
        }
    }

    /**
     * Handle mouse leaving the chart area
     */
    _handleMouseLeave() {
        if (this.interactiveGroup) {
            this.interactiveGroup.style.display = 'none';
        }
        
        if (this.onHoverEnd) {
            this.onHoverEnd();
        }
    }
}
