/**
 * IGC File Parser for Paragliding Tracks (Performance Optimized)
 * Parses standard FAI IGC files, downsamples points on-the-fly for large files
 * to prevent Garbage Collection overhead, and computes telemetry statistics.
 */

class IGCParser {
    /**
     * Parses raw IGC text content
     * @param {string} text - Raw IGC file contents
     * @param {string} filename - Name of the file
     * @returns {Object} Parsed track data and statistics
     */
    static parse(text, filename = 'track.igc') {
        const lines = text.split(/\r?\n/);
        const points = [];
        let date = null;
        let pilot = 'Unknown Pilot';
        let gliderType = 'Unknown Glider';
        let gliderId = '';
        let site = '';
        const rawHeaders = [];

        // Pre-scan to count B-records for dynamic downsampling
        let bRecordCount = 0;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line && line[0] === 'B') {
                bRecordCount++;
            }
        }

        // We want to limit points in memory to ~2000 per track for buttery-smooth SVG rendering
        const sampleRate = Math.max(1, Math.ceil(bRecordCount / 2000));

        const stats = {
            distance: 0,
            duration: 0,
            maxAlt: 0,
            minAlt: Infinity,
            heightGain: 0,
            avgSpeed: 0,
            maxSpeed: 0,
            maxClimb: 0,
            maxSink: 0,
            startAlt: 0,
            endAlt: 0
        };

        let totalDistanceM = 0;
        let firstSec = null;
        let lastSec = null;

        // Telemetry calculation variables
        let prevLat = null;
        let prevLng = null;
        let prevAlt = null;
        let prevTimeSec = null;

        const speedBuffer = [];
        const climbBuffer = [];
        const windowSize = 5; // 5-second smoothing window

        let bIndex = 0;
        let lastParsedPoint = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line) continue;

            const recordType = line[0];

            if (recordType === 'H') {
                rawHeaders.push(line.replace(/\r$/, ''));
                if (line.includes('DTE')) {
                    date = this._parseDate(line) || date;
                } else if (line.includes('PLT') || line.includes('PILOT')) {
                    pilot = this._parseHeaderField(line, ['PLT', 'PILOT', 'PILOTINCHARGE']) || pilot;
                } else if (line.includes('GTY') || line.includes('GLIDER')) {
                    gliderType = this._parseHeaderField(line, ['GTY', 'GLIDER']) || gliderType;
                } else if (line.includes('GID') || line.includes('GLIDERID')) {
                    gliderId = this._parseHeaderField(line, ['GID', 'GLIDERID']) || gliderId;
                } else if (line.includes('SIT')) {
                    site = this._parseHeaderField(line, ['SIT']) || site;
                }
            } else if (recordType === 'B') {
                if (line.length < 35) continue;

                // Parse B-record primitives
                const validity = line[24];
                if (validity !== 'A' && validity !== 'a') {
                    // Skip invalid fixes if FAI standard indicates warning
                }

                // Extract lat/lng strings
                const latPart = line.substring(7, 15);
                const lonPart = line.substring(15, 24);
                
                const latDeg = parseInt(latPart.substring(0, 2), 10);
                const latMin = parseInt(latPart.substring(2, 7), 10) / 1000;
                let lat = latDeg + latMin / 60;
                if (latPart[7] === 'S' || latPart[7] === 's') {
                    lat = -lat;
                }

                const lonDeg = parseInt(lonPart.substring(0, 3), 10);
                const lonMin = parseInt(lonPart.substring(3, 8), 10) / 1000;
                let lon = lonDeg + lonMin / 60;
                if (lonPart[8] === 'W' || lonPart[8] === 'w') {
                    lon = -lon;
                }

                const pressAlt = parseInt(line.substring(25, 30), 10);
                const gpsAlt = parseInt(line.substring(30, 35), 10);
                const altitude = gpsAlt > 0 ? gpsAlt : pressAlt;

                const timePart = line.substring(1, 7);
                const timeSec = this._timeToSeconds(timePart);

                if (isNaN(lat) || isNaN(lon) || isNaN(altitude)) {
                    continue;
                }

                bIndex++;

                // Update flight metadata
                if (firstSec === null) {
                    firstSec = timeSec;
                    stats.startAlt = altitude;
                    stats.minAlt = altitude;
                    stats.maxAlt = altitude;
                }

                lastSec = timeSec;

                // Compute statistics using high-resolution points
                if (prevLat !== null) {
                    const distM = this._haversine(prevLat, prevLng, lat, lon);
                    totalDistanceM += distM;

                    if (altitude > stats.maxAlt) stats.maxAlt = altitude;
                    if (altitude < stats.minAlt) stats.minAlt = altitude;

                    const timeDiff = timeSec - prevTimeSec;
                    if (timeDiff > 0 && timeDiff < 600) {
                        const speed = (distM / timeDiff) * 3.6;
                        if (speed < 150) {
                            speedBuffer.push(speed);
                            if (speedBuffer.length > windowSize) speedBuffer.shift();
                            const avgSpeed = speedBuffer.reduce((a, b) => a + b, 0) / speedBuffer.length;
                            if (avgSpeed > stats.maxSpeed) stats.maxSpeed = avgSpeed;
                        }

                        const climb = (altitude - prevAlt) / timeDiff;
                        climbBuffer.push(climb);
                        if (climbBuffer.length > windowSize) climbBuffer.shift();
                        const avgClimb = climbBuffer.reduce((a, b) => a + b, 0) / climbBuffer.length;
                        if (avgClimb > stats.maxClimb) stats.maxClimb = avgClimb;
                        if (avgClimb < stats.maxSink) stats.maxSink = avgClimb;
                    }
                }

                prevLat = lat;
                prevLng = lon;
                prevAlt = altitude;
                prevTimeSec = timeSec;

                const timeStr = `${timePart.substring(0, 2)}:${timePart.substring(2, 4)}:${timePart.substring(4, 6)}`;
                lastParsedPoint = {
                    timeStr,
                    timeSec,
                    lat,
                    lng: lon,
                    alt: altitude
                };

                // Only store a point in the points array if it satisfies our sampling step
                // Always keep the very first point
                if (points.length === 0 || bIndex % sampleRate === 0) {
                    points.push(lastParsedPoint);
                }
            }
        }

        // Guarantee that the last parsed point is in the points list
        if (points.length > 0 && lastParsedPoint && points[points.length - 1].timeSec !== lastParsedPoint.timeSec) {
            points.push(lastParsedPoint);
        }

        // Finalize stats
        stats.endAlt = lastParsedPoint ? lastParsedPoint.alt : stats.startAlt;
        stats.tracklogLength = Math.round((totalDistanceM / 1000) * 100) / 100;
        stats.distance = stats.tracklogLength;

        // Run paragliding XC and FAI triangle solver
        const xcStats = XCSolver.solve(points);
        stats.twoPoint = xcStats.twoPoint;
        stats.fivePoint = xcStats.fivePoint;
        stats.faiTriangle = xcStats.faiTriangle;
        stats.flatTriangle = xcStats.flatTriangle;
        stats.faiDetails = xcStats.faiDetails;
        stats.flatDetails = xcStats.flatDetails;
        stats.fivePointDetails = xcStats.fivePointDetails;
        stats.xcontestPoints = xcStats.xcontestPoints;
        stats.xcontestType = xcStats.xcontestType;

        if (firstSec !== null && lastSec !== null) {
            if (lastSec >= firstSec) {
                stats.duration = lastSec - firstSec;
            } else {
                stats.duration = (86400 - firstSec) + lastSec;
            }
        }

        stats.heightGain = Math.max(0, stats.maxAlt - stats.startAlt);
        if (stats.duration > 0) {
            stats.avgSpeed = Math.round((stats.fivePoint / (stats.duration / 3600)) * 10) / 10;
        }

        stats.maxSpeed = Math.round(stats.maxSpeed * 10) / 10;
        stats.maxClimb = Math.round(stats.maxClimb * 10) / 10;
        stats.maxSink = Math.round(stats.maxSink * 10) / 10;
        stats.maxAlt = Math.round(stats.maxAlt);
        stats.minAlt = stats.minAlt === Infinity ? 0 : Math.round(stats.minAlt);

        if (!date) {
            const today = new Date();
            date = today.toISOString().split('T')[0];
        }

        const glider = gliderId ? `${gliderType} (${gliderId})` : gliderType;

        // Convert trailing ",CC" country code to flag emoji (e.g. ",CH" → 🇨🇭)
        if (site) {
            const match = site.match(/^(.*),([A-Z]{2})$/);
            if (match) {
                const flag = [...match[2]].map(c =>
                    String.fromCodePoint(c.codePointAt(0) + 0x1F1A5)
                ).join('');
                site = `${match[1].trim()} ${flag}`;
            }
        }

        return {
            filename,
            date,
            pilot,
            glider,
            site,
            rawHeaders,
            points,
            stats
        };
    }

    /**
     * Parses Date from H-Record
     */
    static _parseDate(line) {
        const clean = line.replace(/\s+/g, '');
        const match = clean.match(/DTE(?:DATE:)?(\d{2})(\d{2})(\d{2})/i) || clean.match(/DTE(\d{2})(\d{2})(\d{2})/i);
        if (match) {
            const day = match[1];
            const month = match[2];
            const year = match[3];
            const century = parseInt(year, 10) < 80 ? '20' : '19';
            return `${century}${year}-${month}-${day}`;
        }
        return null;
    }

    /**
     * Extracts values for headers
     */
    static _parseHeaderField(line, keywords) {
        // IGC H-records always use ':' as the separator (e.g. HFPLTPILOTINCHARGE:John)
        // Use the colon as the primary split point — everything after it is the value.
        const colonIdx = line.indexOf(':');
        if (colonIdx !== -1) {
            const val = line.substring(colonIdx + 1).trim();
            if (val) return val;
            return null; // Field present but empty (e.g. "HFPLTPILOT:")
        }
        // Fallback for malformed lines without a colon: try keyword-based extraction
        for (const kw of keywords) {
            const index = line.indexOf(kw);
            if (index !== -1) {
                const val = line.substring(index + kw.length).trim();
                if (val) return val;
            }
        }
        return null;
    }

    /**
     * Converts HHMMSS string to seconds from midnight
     */
    static _timeToSeconds(timeStr) {
        const h = parseInt(timeStr.substring(0, 2), 10);
        const m = parseInt(timeStr.substring(2, 4), 10);
        const s = parseInt(timeStr.substring(4, 6), 10);
        return h * 3600 + m * 60 + s;
    }

    /**
     * Haversine distance formula between two lat/lon coordinates
     */
    static _haversine(lat1, lon1, lat2, lon2) {
        const R = 6371000; // Earth radius in meters
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }
}

/**
 * Paragliding XC & FAI Triangle Solver
 * Computes 2-point open distance, 5-point chronological turnpoints,
 * and FAI closed triangles using Ramer-Douglas-Peucker simplification
 * and dynamic programming.
 */
class XCSolver {
    static solve(points) {
        const result = {
            twoPoint: 0,
            fivePoint: 0,
            faiTriangle: 0,
            flatTriangle: 0,
            faiDetails: null,
            flatDetails: null,
            fivePointDetails: null,
            xcontestPoints: 0,
            xcontestType: 'Open Distance'
        };

        if (points.length < 2) return result;

        // Step 1: Simplify track coordinates for optimization
        // RDP preserves turnpoints (extremes) while reducing points count to M <= 120
        let epsilon = 0.00015; // ~15 meters resolution
        let simplified = this.simplify(points, epsilon);
        while (simplified.length > 120 && epsilon < 0.005) {
            epsilon *= 1.5;
            simplified = this.simplify(points, epsilon);
        }
        const M = simplified.length;

        // Step 2: Precompute Haversine distance matrix for fast lookups
        const distMatrix = Array(M).fill().map(() => Array(M).fill(0));
        for (let i = 0; i < M; i++) {
            for (let j = i; j < M; j++) {
                const d = this.haversine(simplified[i].lat, simplified[i].lng, simplified[j].lat, simplified[j].lng);
                distMatrix[i][j] = d;
                distMatrix[j][i] = d;
            }
        }

        const getDist = (idx1, idx2) => distMatrix[idx1][idx2];

        // 1. Solve 2-Point Distance (max straight-line distance between any 2 points)
        let max2Pt = 0;
        for (let i = 0; i < M; i++) {
            for (let j = i + 1; j < M; j++) {
                const d = getDist(i, j);
                if (d > max2Pt) max2Pt = d;
            }
        }
        result.twoPoint = Math.round((max2Pt / 1000) * 100) / 100;

        // 2. Solve 5-Point Distance (Start -> TP1 -> TP2 -> TP3 -> Finish)
        // Solved in O(K * M^2) via Dynamic Programming (K=4 legs) with backpointers
        const DP = Array(5).fill().map(() => Array(M).fill(null));
        
        // Base case: 1 leg ending at point x
        for (let x = 1; x < M; x++) {
            let maxD = 0;
            let parent = 0;
            for (let y = 0; y < x; y++) {
                const d = getDist(y, x);
                if (d > maxD) {
                    maxD = d;
                    parent = y;
                }
            }
            DP[1][x] = { dist: maxD, parent: parent };
        }

        // DP state transitions for legs 2, 3, and 4
        for (let c = 2; c <= 4; c++) {
            for (let x = c; x < M; x++) {
                let maxD = 0;
                let parent = c - 1;
                for (let y = c - 1; y < x; y++) {
                    const prev = DP[c - 1][y];
                    if (prev) {
                        const val = prev.dist + getDist(y, x);
                        if (val > maxD) {
                            maxD = val;
                            parent = y;
                        }
                    }
                }
                DP[c][x] = { dist: maxD, parent: parent };
            }
        }

        let max5Pt = 0;
        let bestX = 4;
        for (let x = 4; x < M; x++) {
            const entry = DP[4][x];
            if (entry && entry.dist > max5Pt) {
                max5Pt = entry.dist;
                bestX = x;
            }
        }
        result.fivePoint = Math.round((max5Pt / 1000) * 100) / 100;

        // Backtrack 5-Point Path if found
        if (M >= 5 && DP[4][bestX]) {
            const idx4 = bestX;
            const idx3 = DP[4][idx4].parent;
            const idx2 = DP[3][idx3].parent;
            const idx1 = DP[2][idx2].parent;
            const idx0 = DP[1][idx1].parent;

            result.fivePointDetails = {
                start: [simplified[idx0].lng, simplified[idx0].lat],
                tp1: [simplified[idx1].lng, simplified[idx1].lat],
                tp2: [simplified[idx2].lng, simplified[idx2].lat],
                tp3: [simplified[idx3].lng, simplified[idx3].lat],
                finish: [simplified[idx4].lng, simplified[idx4].lat],
                distanceKm: result.fivePoint
            };
        }

        // 3. Solve Triangles (Flat & FAI)
        // Precompute min gap matrix and optimal start/finish pointers in O(M^2)
        const minGap = Array(M).fill().map(() => Array(M).fill(null));
        for (let i = 0; i < M; i++) {
            for (let k = M - 1; k >= 0; k--) {
                let bestVal = getDist(i, k);
                let bestS = i;
                let bestF = k;

                if (i > 0) {
                    const up = minGap[i - 1][k];
                    if (up && up.gap < bestVal) {
                        bestVal = up.gap;
                        bestS = up.s;
                        bestF = up.f;
                    }
                }
                if (k < M - 1) {
                    const right = minGap[i][k + 1];
                    if (right && right.gap < bestVal) {
                        bestVal = right.gap;
                        bestS = right.s;
                        bestF = right.f;
                    }
                }
                minGap[i][k] = { gap: bestVal, s: bestS, f: bestF };
            }
        }

        let bestFAI = 0;
        let bestFAIDetails = null;
        let bestFlat = 0;
        let bestFlatDetails = null;

        for (let i = 0; i < M; i++) {
            for (let j = i + 1; j < M; j++) {
                const leg1 = getDist(i, j);
                for (let k = j + 1; k < M; k++) {
                    const leg2 = getDist(j, k);
                    const leg3 = getDist(k, i);
                    const perimeter = leg1 + leg2 + leg3;

                    if (perimeter === 0) continue;

                    const minLeg = Math.min(leg1, leg2, leg3);
                    const entry = minGap[i][k];

                    if (entry && entry.gap <= 0.20 * perimeter) {
                        const score = perimeter - entry.gap;

                        // 1. Flat Triangle (no shortest leg ratio restriction)
                        if (score > bestFlat) {
                            bestFlat = score;
                            bestFlatDetails = {
                                s: simplified[entry.s],
                                i: simplified[i],
                                j: simplified[j],
                                k: simplified[k],
                                f: simplified[entry.f],
                                perimeter,
                                gap: entry.gap
                            };
                        }

                        // 2. FAI Triangle (shortest leg >= 28%)
                        if (minLeg >= 0.28 * perimeter) {
                            if (score > bestFAI) {
                                bestFAI = score;
                                bestFAIDetails = {
                                    s: simplified[entry.s],
                                    i: simplified[i],
                                    j: simplified[j],
                                    k: simplified[k],
                                    f: simplified[entry.f],
                                    perimeter,
                                    gap: entry.gap
                                };
                            }
                        }
                    }
                }
            }
        }

        result.faiTriangle = Math.round((bestFAI / 1000) * 100) / 100;
        result.flatTriangle = Math.round((bestFlat / 1000) * 100) / 100;

        if (bestFAIDetails) {
            result.faiDetails = {
                start: [bestFAIDetails.s.lng, bestFAIDetails.s.lat],
                tp1: [bestFAIDetails.i.lng, bestFAIDetails.i.lat],
                tp2: [bestFAIDetails.j.lng, bestFAIDetails.j.lat],
                tp3: [bestFAIDetails.k.lng, bestFAIDetails.k.lat],
                finish: [bestFAIDetails.f.lng, bestFAIDetails.f.lat],
                perimeterKm: Math.round((bestFAIDetails.perimeter / 1000) * 10) / 10,
                gapKm: Math.round((bestFAIDetails.gap / 1000) * 10) / 10
            };
        }

        if (bestFlatDetails) {
            result.flatDetails = {
                start: [bestFlatDetails.s.lng, bestFlatDetails.s.lat],
                tp1: [bestFlatDetails.i.lng, bestFlatDetails.i.lat],
                tp2: [bestFlatDetails.j.lng, bestFlatDetails.j.lat],
                tp3: [bestFlatDetails.k.lng, bestFlatDetails.k.lat],
                finish: [bestFlatDetails.f.lng, bestFlatDetails.f.lat],
                perimeterKm: Math.round((bestFlatDetails.perimeter / 1000) * 10) / 10,
                gapKm: Math.round((bestFlatDetails.gap / 1000) * 10) / 10
            };
        }

        // XContest Scoring optimization (standard paragliding rules)
        const fivePointPoints = result.fivePoint * 1.00; // Open Distance matches 5-Pt distance exactly

        let flatTrianglePoints = 0;
        if (bestFlatDetails) {
            const isClosed = bestFlatDetails.gap <= 0.05 * bestFlatDetails.perimeter;
            const multiplier = isClosed ? 1.40 : 1.20;
            flatTrianglePoints = result.flatTriangle * multiplier;
        }

        let faiTrianglePoints = 0;
        if (bestFAIDetails) {
            const isClosed = bestFAIDetails.gap <= 0.05 * bestFAIDetails.perimeter;
            const multiplier = isClosed ? 1.60 : 1.40;
            faiTrianglePoints = result.faiTriangle * multiplier;
        }

        let bestPoints = fivePointPoints;
        let bestType = 'Open Distance';

        if (flatTrianglePoints > bestPoints) {
            bestPoints = flatTrianglePoints;
            bestType = 'Flat Triangle';
        }
        if (faiTrianglePoints > bestPoints) {
            bestPoints = faiTrianglePoints;
            bestType = 'FAI Triangle';
        }

        result.xcontestPoints = Math.round(bestPoints * 100) / 100;
        result.xcontestType = bestType;
        result.scoringVersion = 3;

        return result;
    }

    /**
     * Ramer-Douglas-Peucker simplification
     */
    static simplify(points, epsilon) {
        if (points.length <= 2) return points;
        
        let maxDist = 0;
        let index = 0;
        const end = points.length - 1;
        
        for (let i = 1; i < end; i++) {
            const dist = this.perpendicularDistance(points[i], points[0], points[end]);
            if (dist > maxDist) {
                index = i;
                maxDist = dist;
            }
        }
        
        if (maxDist > epsilon) {
            const results1 = this.simplify(points.slice(0, index + 1), epsilon);
            const results2 = this.simplify(points.slice(index), epsilon);
            return results1.slice(0, results1.length - 1).concat(results2);
        } else {
            return [points[0], points[end]];
        }
    }

    static perpendicularDistance(p, lineStart, lineEnd) {
        const x0 = p.lng, y0 = p.lat;
        const x1 = lineStart.lng, y1 = lineStart.lat;
        const x2 = lineEnd.lng, y2 = lineEnd.lat;
        
        const numerator = Math.abs((y2 - y1) * x0 - (x2 - x1) * y0 + x2 * y1 - y2 * x1);
        const denominator = Math.sqrt((y2 - y1) * (y2 - y1) + (x2 - x1) * (x2 - x1));
        
        return denominator === 0 ? 0 : numerator / denominator;
    }

    static haversine(lat1, lon1, lat2, lon2) {
        const R = 6371000;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }
}
