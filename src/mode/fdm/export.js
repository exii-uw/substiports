/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

"use strict";

(function() {

    let KIRI = self.kiri,
        BASE = self.base,
        UTIL = BASE.util,
        FDM = KIRI.driver.FDM;

    /**
     * @returns {Array} gcode lines
     */
    FDM.export = function(print, online) {
        let layers = print.output,
            settings = FDM.fixExtruders(print.settings),
            device = settings.device,
            extruders = device.extruders,
            process = settings.process,
            gcodeFan = device.gcodeFan,
            gcodeLayer = device.gcodeLayer,
            gcodeTrack = device.gcodeTrack,
            tool = 0,
            isBelt = device.bedBelt,
            bedType = isBelt ? "belt" : "fixed",
            extruder = extruders[tool],
            offset_x = extruder.extOffsetX,
            offset_y = extruder.extOffsetY,
            extrudeAbs = device.extrudeAbs,
            time = 0,
            layer = 0,
            pause = [],
            pauseCmd = device.gcodePause,
            output = [],
            outputLength = 0,
            lastProgress = 0,
            decimals = BASE.config.gcode_decimals || 4,
            progress = 0,
            distance = 0,
            emitted = 0,
            retracted = 0,
            pos = {x:0, y:0, z:0, f:0},
            last = null,
            zpos = 0,
            zhop = process.zHopDistance || 0,
            seekMMM = process.outputSeekrate * 60,
            retDist = process.outputRetractDist,
            retSpeed = process.outputRetractSpeed * 60,
            retDwell = process.outputRetractDwell || 0,
            timeDwell = retDwell / 1000,
            offset = process.outputOriginCenter ? null : {
                x: device.bedWidth/2,
                y: isBelt ? 0 : device.bedDepth/2
            },
            subst = {
                travel_speed: seekMMM,
                retract_speed: retSpeed,
                retract_distance: retDist,
                temp: process.firstLayerNozzleTemp || process.outputTemp,
                temp_bed: process.firstLayerBedTemp || process.outputBedTemp,
                bed_temp: process.firstLayerBedTemp || process.outputBedTemp,
                fan_speed: process.outputFanMax,
                speed: process.outputFanMax, // legacy
                top: offset ? device.bedDepth : device.bedDepth/2,
                left: offset ? 0 : -device.bedWidth/2,
                right: offset ? device.bedWidth : device.bedWidth/2,
                bottom: offset ? 0 : -device.bedDepth/2,
                z_max: device.maxHeight,
                layers: layers.length,
                nozzle: 0,
                tool: 0
            },
            pidx, path, out, speedMMM, emitMM, emitPerMM, lastp, laste, dist,
            append,
            lines = 0,
            bytes = 0,
            bcos = Math.cos(Math.PI/4),
            icos = 1 / bcos;

        (process.gcodePauseLayers || "").split(",").forEach(function(lv) {
            let v = parseInt(lv);
            if (v >= 0) pause.push(v);
        });

        append = function(line) {
            if (line) {
                lines++;
                bytes += line.length;
                output.append(line);
            }
            if (!line || output.length > 1000) {
                online(output.join("\n"));
                output = [];
            }
        };

        function appendSub(line) {
            append(print.constReplace(line, subst));
        }

        function appendAll(arr) {
            if (!arr) return;
            if (!Array.isArray(arr)) arr = [ arr ];
            arr.forEach(function(line) { append(line) });
        }

        function appendAllSub(arr) {
            if (!arr) return;
            if (!Array.isArray(arr)) arr = [ arr ];
            arr.forEach(function(line) { appendSub(line) });
        }

        append(`; Generated by Kiri:Moto ${KIRI.version}`);
        append(`; ${new Date().toString()}`);
        appendSub("; Bed left:{left} right:{right} top:{top} bottom:{bottom}");
        append(`; Bed type: ${bedType}`);
        append(`; Target: ${settings.filter[settings.mode]}`);
        append("; --- process ---");
        for (let pk in process) {
            append("; " + pk + " = " + process[pk]);
        }
        append("; --- startup ---");
        let t0 = false;
        let t1 = false;
        for (let i=0; i<device.gcodePre.length; i++) {
            let line = device.gcodePre[i];
            if (line.indexOf('T0') >= 0) t0 = true; else
            if (line.indexOf('T1') >= 0) t1 = true; else
            if (line.indexOf('M82') >= 0) extrudeAbs = true; else
            if (line.indexOf('M83') >= 0) extrudeAbs = false; else
            if (line.indexOf('G90') >= 0) extrudeAbs = true; else
            if (line.indexOf('G91') >= 0) extrudeAbs = false; else
            if (line.indexOf('G92') === 0) {
                line.split(";")[0].split(' ').forEach(function (tok) {
                    let val = parseFloat(tok.substring(1) || 0) || 0;
                    switch (tok[0]) {
                        case 'X': pos.x = val; break;
                        case 'Y': pos.y = val; break;
                        case 'Z': pos.z = val; break;
                        case 'E': outputLength = val; break;
                    }
                });
            }
            if (extrudeAbs && line.indexOf('E') > 0) {
                line.split(";")[0].split(' ').forEach(function (tok) {
                    // use max E position from gcode-preamble
                    if (tok[0] == 'E') {
                        outputLength = Math.max(outputLength, parseFloat(tok.substring(1)) || 0);
                    }
                });
            }
            if (line.indexOf("{tool}") > 0 && extruders.length > 1) {
                for (let i=0; i<extruders.length; i++) {
                    subst.tool = i;
                    appendSub(line);
                }
                subst.tool = 0;
            } else {
                appendSub(line);
            }
        }

        function dwell(ms) {
            append(`G4 P${ms}`);
            time += timeDwell;
        }

        function retract(zhop) {
            retracted = retDist;
            moveTo({e:-retracted}, retSpeed, `e-retract ${retDist}`);
            if (zhop) moveTo({z:zpos + zhop}, seekMMM, "z-hop start");
            time += (retDist / retSpeed) * 60 * 2; // retraction time
        }

        let taxis = new THREE.Vector3( 1, 0, 0 );
        let tcent = new THREE.Vector2( 0, 0 );
        let angle = -Math.PI / 4;

        function moveTo(newpos, rate, comment) {
            if (comment) {
                append(";; " + comment);
            }
            let o = [!rate && !newpos.e ? 'G0' : 'G1'];
            // put out x,y,z in belt mode if not engage/retract
            let xyz = newpos.x || newpos.y || newpos.z;
            let emit = { x: xyz && isBelt, y: xyz && isBelt, z: xyz && isBelt };
            if (typeof newpos.x === 'number') {
                pos.x = newpos.x;
                emit.x = true;
            }
            if (typeof newpos.y === 'number') {
                pos.y = newpos.y;
                emit.y = true;
            }
            if (typeof newpos.z === 'number') {
                pos.z = newpos.z;
                emit.z = true;
            }
            let epos = isBelt ? { x: pos.x, y: pos.y, z: pos.z } : pos;
            if (isBelt) {
                epos.x = pos.x;
                epos.z = pos.z * icos;
                epos.y = -pos.y + epos.z * bcos;
            }
            if (emit.x) o.append(" X").append(epos.x.toFixed(decimals));
            if (emit.y) o.append(" Y").append(epos.y.toFixed(decimals));
            if (emit.z) o.append(" Z").append(epos.z.toFixed(decimals));
            if (typeof newpos.e === 'number') {
                outputLength += newpos.e;
                if (extrudeAbs) {
                    // for cumulative (absolute) extruder positions
                    o.append(" E").append(outputLength.toFixed(decimals));
                } else {
                    o.append(" E").append(newpos.e.toFixed(decimals));
                }
            }
            if (rate && rate != pos.f) {
                o.append(" F").append(Math.round(rate));
                pos.f = rate
            }
            let line = o.join('');
            if (last == line) {
                // console.log({dup:line});
                return;
            }
            last = line;
            append(line);
        }

        // calc total distance traveled by head as proxy for progress
        let allout = [], totaldistance = 0;
        layers.forEach(function(outs) {
            allout.appendAll(outs);
        });
        allout.forEachPair(function (o1, o2) {
            totaldistance += o1.point.distTo2D(o2.point);
        }, 1);

        // retract before first move
        retract();

        while (layer < layers.length) {
            path = layers[layer];
            emitPerMM = print.extrudePerMM(
                extruder.extNozzle,
                extruder.extFilament,
                path.layer === 0 ?
                    (process.firstSliceHeight || process.sliceHeight) : path.height);

            subst.z = zpos = path.z;
            // subst.z = (zpos + path.height).toFixed(3);
            subst.Z = subst.z;
            subst.layer = layer;
            subst.height = path.height.toFixed(3);

            if (pauseCmd && pause.indexOf(layer) >= 0) {
                appendAllSub(pauseCmd)
            }

            if (gcodeLayer && gcodeLayer.length) {
                appendAllSub(gcodeLayer);
            } else {
                append(`;; --- layer ${layer} (${subst.height} @ ${subst.z}) ---`);
            }

            if (layer > 0 && process.outputLayerRetract) {
                retract();
            }

            // enable fan at fan layer
            if (gcodeFan && layer === process.outputFanLayer) {
                appendAllSub(gcodeFan);
            }

            // second layer transitions
            if (layer === 1) {
                // update temps when first layer overrides are present
                if (process.firstLayerNozzleTemp) {
                    subst.temp = process.outputTemp;
                    if (t0) appendSub("M104 S{temp} T0");
                    if (t1) appendSub("M104 S{temp} T1");
                    if (!(t0 || t1)) appendSub("M104 S{temp} T{tool}");
                }
                if (process.firstLayerBedTemp) {
                    subst.bed_temp = subst.temp_bed = process.outputBedTemp;
                    appendSub("M140 S{temp_bed} T0");
                }
            }

            // move Z to layer height
            if (layer > 0 || !isBelt) {
                moveTo({z:zpos}, seekMMM);
            }

            // iterate through layer outputs
            for (pidx=0; pidx<path.length; pidx++) {
                out = path[pidx];
                speedMMM = (out.speed || process.outputFeedrate) * 60;

                // look for extruder change and recalc emit factor
                if (out.tool !== undefined && out.tool !== tool) {
                    tool = out.tool;
                    subst.nozzle = subst.tool = tool;
                    extruder = extruders[tool];
                    offset_x = extruder.extOffsetX;
                    offset_y = extruder.extOffsetY;
                    emitPerMM = print.extrudePerMM(
                        extruder.extNozzle,
                        extruder.extFilament,
                        path.layer === 0 ?
                            (process.firstSliceHeight || process.sliceHeight) : path.height);
                    appendAllSub(extruder.extSelect);
                }

                // if no point in output, it's a dwell command
                if (!out.point) {
                    dwell(out.speed);
                    continue;
                }

                let x = out.point.x + offset_x,
                    y = out.point.y + offset_y,
                    z = out.point.z;

                // adjust for inversions and origin offsets
                if (process.outputInvertX) x = -x;
                if (process.outputInvertY) y = -y;
                if (offset) {
                    x += offset.x;
                    y += offset.y;
                }

                dist = lastp ? lastp.distTo2D(out.point) : 0;

                // re-engage post-retraction before new extrusion
                if (out.emit && retracted) {
                    // when enabled, resume previous Z
                    if (zhop && pos.z != zpos) moveTo({z:zpos}, seekMMM, "z-hop end");
                    // re-engage retracted filament
                    moveTo({e:retracted}, retSpeed, `e-engage ${retracted}`);
                    retracted = 0;
                    // optional dwell after re-engaging filament to allow pressure to build
                    if (retDwell) dwell(retDwell);
                    time += (retDist / retSpeed) * 60 * 2; // retraction time
                }

                if (lastp && out.emit) {
                    emitMM = emitPerMM * out.emit * dist;
                    moveTo({x:x, y:y, e:emitMM}, speedMMM);
                    emitted += emitMM;
                } else {
                    moveTo({x:x, y:y}, seekMMM);
                    // TODO disabling out of plane z moves until a better mechanism
                    // can be built that doesn't rely on computed zpos from layer heights...
                    // when making z moves (like polishing) allow slowdown vs fast seek
                    // let moveSpeed = (lastp && lastp.z !== z) ? speedMMM : seekMMM;
                    // moveTo({x:x, y:y, z:z}, moveSpeed);
                }

                // retract filament if point retract flag set
                if (!retracted && out.retract) {
                    retract(zhop);
                }

                // update time and distance (should calc in moveTo() instead)
                time += (dist / speedMMM) * 60 * 1.5;
                distance += dist;
                subst.progress = progress = Math.round((distance / totaldistance) * 100);

                // emit tracked progress
                if (gcodeTrack && progress != lastProgress) {
                    appendAllSub(gcodeTrack);
                    lastProgress = progress;
                }

                lastp = out.point;
                laste = out.emit;
            }
            layer++;
        }

        subst.time = UTIL.round(time,2);
        subst.material = UTIL.round(emitted,2);

        append("; --- shutdown ---");
        appendAllSub(device.gcodePost);
        append(`; --- filament used: ${subst.material} mm ---`);
        append(`; --- print time: ${time.toFixed(0)}s ---`);

        // force emit of buffer
        append();

        print.distance = emitted;
        print.lines = lines;
        print.bytes = bytes + lines - 1;
        print.time = time;
    };

})();
