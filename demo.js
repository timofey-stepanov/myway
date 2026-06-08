/**
 * Demo Track Generator
 * Programmatically generates realistic paragliding flight tracks in raw IGC format.
 * Simulates real paragliding maneuvers: thermalling (climbing in circles with wind drift),
 * ridge soaring (figure-8 sweeps), and cross-country glides.
 */

class DemoTracks {
    /**
     * Returns an array of demo files
     * @returns {Array<{filename: string, content: string}>}
     */
    static getTracks() {
        return [
            {
                filename: 'bassano_evening_glide.igc',
                content: this._generateEveningGlide()
            },
            {
                filename: 'monte_grappa_ridge_soaring.igc',
                content: this._generateRidgeSoaring()
            },
            {
                filename: 'bassano_feltre_xc.igc',
                content: this._generateXCFlight()
            }
        ];
    }

    // --- Helper Formatter Functions ---

    static _formatLat(lat) {
        const isSouth = lat < 0;
        const val = Math.abs(lat);
        const deg = Math.floor(val);
        const minVal = (val - deg) * 60;
        const min = Math.floor(minVal);
        const mmm = Math.round((minVal - min) * 1000);
        
        const degStr = deg.toString().padStart(2, '0');
        const minStr = min.toString().padStart(2, '0');
        const mmmStr = mmm.toString().substring(0, 3).padStart(3, '0');
        const suffix = isSouth ? 'S' : 'N';
        return `${degStr}${minStr}${mmmStr}${suffix}`;
    }

    static _formatLon(lon) {
        const isWest = lon < 0;
        const val = Math.abs(lon);
        const deg = Math.floor(val);
        const minVal = (val - deg) * 60;
        const min = Math.floor(minVal);
        const mmm = Math.round((minVal - min) * 1000);
        
        const degStr = deg.toString().padStart(3, '0');
        const minStr = min.toString().padStart(2, '0');
        const mmmStr = mmm.toString().substring(0, 3).padStart(3, '0');
        const suffix = isWest ? 'W' : 'E';
        return `${degStr}${minStr}${mmmStr}${suffix}`;
    }

    static _formatAlt(alt) {
        const rounded = Math.max(0, Math.round(alt));
        return rounded.toString().padStart(5, '0');
    }

    static _formatTime(sec) {
        const h = Math.floor(sec / 3600) % 24;
        const m = Math.floor((sec % 3600) / 60);
        const s = sec % 60;
        return [h, m, s].map(v => v.toString().padStart(2, '0')).join('');
    }

    /**
     * Generates a single B-record line
     */
    static _createBRecord(sec, lat, lon, alt) {
        const timeStr = this._formatTime(sec);
        const latStr = this._formatLat(lat);
        const lonStr = this._formatLon(lon);
        const altStr = this._formatAlt(alt);
        // B HHMMSS DDMMmmmN DDDMMmmmE A PPPPP GGGGG
        // For simplicity, we write the same altitude for pressure and GPS
        return `B${timeStr}${latStr}${lonStr}A${altStr}${altStr}`;
    }

    // --- Track Generators ---

    /**
     * 1. Evening Sunset Glide (simple, smooth, descending flight)
     */
    static _generateEveningGlide() {
        const header = [
            'AXXXXX Demo Flight Recorder',
            'HFDTE080626', // Date: 08 June 2026
            'HFPLTPILOTINCHARGE: Marc Andre',
            'HFGTYGLIDER: Ozone Buzz Z6',
            'HFGIDGLIDERID: OO-BUZ',
            'I013638FXA'
        ];

        const records = [...header];
        
        // Start: Bassano Takeoff Da Stella (45.8126, 11.7778, 850m)
        // End: Semonzo Garden Landing (45.7984, 11.7581, 190m)
        const duration = 600; // 10 minutes
        const startTime = 61200; // 17:00:00

        const startLat = 45.8126, startLng = 11.7778, startAlt = 850;
        const endLat = 45.7984, endLng = 11.7581, endAlt = 190;

        for (let t = 0; t <= duration; t += 2) {
            const ratio = t / duration;
            const timeSec = startTime + t;

            // Glide with a slight wind drift curve
            const currentLat = startLat + (endLat - startLat) * ratio + Math.sin(ratio * Math.PI) * 0.001;
            const currentLng = startLng + (endLng - startLng) * ratio;
            
            // Decaying glide: slower sink rate initially, higher sink rate near landing
            const currentAlt = startAlt - (startAlt - endAlt) * Math.pow(ratio, 1.2);

            records.push(this._createBRecord(timeSec, currentLat, currentLng, currentAlt));
        }

        return records.join('\n');
    }

    /**
     * 2. Monte Grappa Ridge Soaring & Thermalling
     * (circles to gain altitude, sweeps back and forth, then landing)
     */
    static _generateRidgeSoaring() {
        const header = [
            'AXXXXX Demo Flight Recorder',
            'HFDTE080626',
            'HFPLTPILOTINCHARGE: Chrigel Maurer',
            'HFGTYGLIDER: Niviuk Artik 6',
            'HFGIDGLIDERID: SUI-18',
            'I013638FXA'
        ];

        const records = [...header];
        let t = 0;
        let timeSec = 43200; // 12:00:00 UTC

        // Takeoff: Da Stella (45.8126, 11.7778, 850m)
        let lat = 45.8126;
        let lng = 11.7778;
        let alt = 850;

        // Phase 1: Launch and search for thermal (60 seconds)
        for (let step = 0; step < 30; step++) {
            lat += 0.00005;
            lng += 0.0001;
            alt -= 0.5; // slow glide
            records.push(this._createBRecord(timeSec, lat, lng, alt));
            timeSec += 2;
        }

        // Phase 2: Core a thermal (climbing in circles, drifting north-east with wind)
        // 20 circles, 30 seconds per circle = 600 seconds
        const thermalCenterLat = lat;
        const thermalCenterLng = lng;
        const radius = 0.0015; // ~150 meters
        const windDriftLat = 0.000005; // very light wind drift
        const windDriftLng = 0.00001;
        const climbRate = 2.0; // 2.0 m/s

        for (let angleSec = 0; angleSec < 600; angleSec += 2) {
            const angle = (angleSec / 30) * 2 * Math.PI; // 30s period
            const driftLat = angleSec * windDriftLat;
            const driftLng = angleSec * windDriftLng;

            const cLat = thermalCenterLat + driftLat + Math.sin(angle) * radius;
            const cLng = thermalCenterLng + driftLng + Math.cos(angle) * radius;
            alt += climbRate * 2; // 2 seconds * 2m/s = 4m climb

            records.push(this._createBRecord(timeSec, cLat, cLng, alt));
            timeSec += 2;
            lat = cLat;
            lng = cLng;
        }
        // Altitude is now around 850 - 15 + 1200 = 2035m

        // Phase 3: Ridge Soaring (Figure-8 sweeps along the main ridge)
        // Sweep back and forth east-west: (45.820, 11.780) to (45.810, 11.820)
        // Duration: 1000 seconds
        const sweepDuration = 1000;
        const startSweepLat = 45.821, startSweepLng = 11.790;
        const endSweepLat = 45.812, endSweepLng = 11.825;

        for (let sweepTime = 0; sweepTime < sweepDuration; sweepTime += 2) {
            const period = sweepTime / 250; // Full loop every 250 seconds
            const phase = Math.sin(period * 2 * Math.PI); // -1 to +1
            
            // Draw a slightly curved figure-8 sweep
            const sLat = startSweepLat + (endSweepLat - startSweepLat) * ((phase + 1) / 2);
            const sLng = startSweepLng + (endSweepLng - startSweepLng) * ((phase + 1) / 2) + Math.cos(period * 2 * Math.PI) * 0.0015;
            
            // Ridge lift allows maintaining altitude with small fluctuations
            alt += Math.sin(sweepTime / 10) * 1.5 - 0.2; 

            records.push(this._createBRecord(timeSec, sLat, sLng, alt));
            timeSec += 2;
            lat = sLat;
            lng = sLng;
        }

        // Phase 4: Descent and landing (400 seconds)
        // Glide towards Semonzo Garden Landing (45.7984, 11.7581)
        const landingLat = 45.7984;
        const landingLng = 11.7581;
        const landingAlt = 190;
        const startLandingAlt = alt;
        const startLandingLat = lat;
        const startLandingLng = lng;
        const landingSteps = 200; // 400 seconds total

        for (let step = 0; step < landingSteps; step++) {
            const ratio = step / landingSteps;
            // S-turns during landing approach:
            const sTurn = Math.sin(ratio * 8 * Math.PI) * 0.001 * (1 - ratio);
            
            const currentLat = startLandingLat + (landingLat - startLandingLat) * ratio + sTurn;
            const currentLng = startLandingLng + (landingLng - startLandingLng) * ratio + sTurn;
            const currentAlt = startLandingAlt - (startLandingAlt - landingAlt) * ratio;

            records.push(this._createBRecord(timeSec, currentLat, currentLng, currentAlt));
            timeSec += 2;
        }

        return records.join('\n');
    }

    /**
     * 3. Cross Country (XC) Flight: Bassano to Feltre (25km flight)
     * (multiple climbs and long straight glides in a specific direction)
     */
    static _generateXCFlight() {
        const header = [
            'AXXXXX Demo Flight Recorder',
            'HFDTE080626',
            'HFPLTPILOTINCHARGE: Antoine Girard',
            'HFGTYGLIDER: Gin Explorer 2',
            'HFGIDGLIDERID: F-XC12',
            'I013638FXA'
        ];

        const records = [...header];
        let timeSec = 41400; // 11:30:00 UTC
        
        // Flight path consists of waypoints where we search, climb, and glide.
        // We will define key stages.
        // Start: Bassano (Stella) (45.8126, 11.7778, 850m)
        let lat = 45.8126;
        let lng = 11.7778;
        let alt = 850;

        // Stage 1: Climb 1 in local thermal
        // 850m to 1600m over 400 seconds
        let result = this._simThermal(timeSec, lat, lng, alt, 1600, 400, 0.0005, 0.0003);
        records.push(...result.records);
        timeSec = result.timeSec; lat = result.lat; lng = result.lng; alt = result.alt;

        // Stage 2: Long Glide East-North-East to Mount Grappa Peak
        // Target: (45.875, 11.802), alt drops to 1200m, duration: 600s
        result = this._simGlide(timeSec, lat, lng, alt, 45.875, 11.802, 1200, 600);
        records.push(...result.records);
        timeSec = result.timeSec; lat = result.lat; lng = result.lng; alt = result.alt;

        // Stage 3: Climb 2 at Monte Grappa peak
        // 1200m to 2100m over 500 seconds
        result = this._simThermal(timeSec, lat, lng, alt, 2100, 500, -0.0002, 0.0006);
        records.push(...result.records);
        timeSec = result.timeSec; lat = result.lat; lng = result.lng; alt = result.alt;

        // Stage 4: Glide Northeast towards Feltre Ridge
        // Target: (45.952, 11.882), alt drops to 1350m, duration: 800s
        result = this._simGlide(timeSec, lat, lng, alt, 45.952, 11.882, 1350, 800);
        records.push(...result.records);
        timeSec = result.timeSec; lat = result.lat; lng = result.lng; alt = result.alt;

        // Stage 5: Climb 3 in ridge thermal
        // 1350m to 1950m over 350 seconds
        result = this._simThermal(timeSec, lat, lng, alt, 1950, 350, 0.0004, 0.0002);
        records.push(...result.records);
        timeSec = result.timeSec; lat = result.lat; lng = result.lng; alt = result.alt;

        // Stage 6: Final Glide to Feltre landing site
        // Target: Feltre Airfield (46.023, 11.932, 270m), duration: 700s
        result = this._simGlide(timeSec, lat, lng, alt, 46.023, 11.932, 270, 700);
        records.push(...result.records);

        return records.join('\n');
    }

    /**
     * Helper to simulate a climbing thermal circle
     */
    static _simThermal(startTime, startLat, startLng, startAlt, targetAlt, duration, driftRateLat, driftRateLng) {
        const records = [];
        let timeSec = startTime;
        let alt = startAlt;
        const steps = Math.floor(duration / 2);
        const climbPerStep = (targetAlt - startAlt) / steps;
        
        let lat = startLat;
        let lng = startLng;
        const radius = 0.0012; // ~120m

        for (let i = 0; i < steps; i++) {
            const angle = (i / 15) * 2 * Math.PI; // 30s per circle
            const driftLat = i * 2 * driftRateLat;
            const driftLng = i * 2 * driftRateLng;

            const currentLat = startLat + driftLat + Math.sin(angle) * radius;
            const currentLng = startLng + driftLng + Math.cos(angle) * radius;
            alt += climbPerStep;

            records.push(this._createBRecord(timeSec, currentLat, currentLng, alt));
            timeSec += 2;
            lat = currentLat;
            lng = currentLng;
        }

        return { records, timeSec, lat, lng, alt };
    }

    /**
     * Helper to simulate a straight glide transition
     */
    static _simGlide(startTime, startLat, startLng, startAlt, targetLat, targetLng, targetAlt, duration) {
        const records = [];
        let timeSec = startTime;
        const steps = Math.floor(duration / 2);
        
        for (let i = 0; i <= steps; i++) {
            const ratio = i / steps;
            const currentLat = startLat + (targetLat - startLat) * ratio;
            const currentLng = startLng + (targetLng - startLng) * ratio;
            const currentAlt = startAlt + (targetAlt - startAlt) * ratio;

            records.push(this._createBRecord(timeSec, currentLat, currentLng, currentAlt));
            timeSec += 2;
        }

        return { 
            records, 
            timeSec, 
            lat: targetLat, 
            lng: targetLng, 
            alt: targetAlt 
        };
    }
}
