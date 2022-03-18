/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

"use strict";

// dep: moto.license
// dep: geo.base
// dep: geo.polygons
// dep: geo.slicer
// dep: geo.wasm
// dep: kiri.codec
// dep: kiri-mode.fdm.post
// dep: ext.clip2
// dep: kiri.kmeans
// use: kiri.pso
// use: kiri.hull
gapp.register("kiri-run.minion", [], (root, exports) => {

const { base, kiri } = root;
const { polygons, newPoint } = base;
const { codec, newKMeans, KMeans, Optimizer, hull } = kiri;

const POLY = polygons;
const clib = self.ClipperLib;
const ctyp = clib.ClipType;
const ptyp = clib.PolyType;
const cfil = clib.PolyFillType;

let name = "unknown";

// catch clipper alerts and convert to console messages
self.alert = function(o) {
    console.log(o);
};

self.onmessage = function(msg) {
    let data = msg.data;
    let cmd = data.cmd;
    (funcs[cmd] || funcs.bad)(data, data.seq);
};

function reply(msg, direct) {
    self.postMessage(msg, direct);
}

function log() {
    console.log(`[${name}]`, ...arguments);
}

const funcs = {
    label(data, seq) {
        name = data.name;
    },

    config: data => {
        if (data.base) {
            Object.assign(base.config, data.base);
        } else {
            log({invalid: data});
        }
    },

    union: (data, seq) => {
        if (!(data.polys && data.polys.length)) {
            reply({ seq, union: codec.encode([]) });
            return;
        }
        let polys = codec.decode(data.polys);
        let union = POLY.union(polys, data.minarea || 0, true);
        reply({ seq, union: codec.encode(union) });
    },

    topShells: (data, seq) => {
        let top = codec.decode(data.top, {full: true});
        let {z, count, offset1, offsetN, fillOffset, opt} = data;
        kiri.driver.FDM.doTopShells(z, top, count, offset1, offsetN, fillOffset, opt);
        reply({ seq, top: codec.encode(top, {full: true}) });
    },

    fill: (data, seq) => {
        let polys = codec.decode(data.polys);
        let { angle, spacing, minLen, maxLen } = data;
        let fill = POLY.fillArea(polys, angle, spacing, [], minLen, maxLen);
        let arr = new Float32Array(fill.length * 4);
        for (let i=0, p=0; p<fill.length; ) {
            let pt = fill[p++];
            arr[i++] = pt.x;
            arr[i++] = pt.y;
            arr[i++] = pt.z;
            arr[i++] = pt.index;
        }
        reply({ seq, fill: arr }, [ arr.buffer ]);
    },

    clip: (data, seq) => {
        let clip = new clib.Clipper();
        let ctre = new clib.PolyTree();
        let clips = [];

        clip.AddPaths(data.lines, ptyp.ptSubject, false);
        clip.AddPaths(data.polys, ptyp.ptClip, true);

        if (clip.Execute(ctyp.ctIntersection, ctre, cfil.pftNonZero, cfil.pftEvenOdd)) {
            for (let node of ctre.m_AllPolys) {
                clips.push(codec.encode(POLY.fromClipperNode(node, data.z)));
            }
        }

        reply({ seq, clips });
    },

    sliceZ: (data, seq) => {
        let { z, points, options } = data;
        let i = 0, p = 0, realp = new Array(points.length / 3);
        while (i < points.length) {
            realp[p++] = base.newPoint(points[i++], points[i++], points[i++]).round(3);
        }
        let output = [];
        base.sliceZ(z, realp, {
            ...options,
            each(out) { output.push(out) }
        }).then(() => {
            for (let rec of output) {
                // lines do not pass codec properly (for now)
                delete rec.lines;
            }
            reply({ seq, output: codec.encode(output) });
        });
    },

    wasm: data => {
        if (data.enable) {
            base.wasm_ctrl.enable();
        } else {
            base.wasm_ctrl.disable();
        }
    },

    test: (data, seq) => {
        console.log({minion_data:data});
        console.log({minion_data:data});
        let { number, coded_slice, slice2, two_list, topList } = data;
        console.log({two_list:two_list});
        let slice3 = codec.decode(data.coded_slice, {full: true});
        let slice4 = codec.encode(slice3);
        let out = [];
        // let outtop = codec.decode(data.coded_tops[0], {full: true});
        let topFromList = topList[0];
        // console.log({outtop:outtop});
        
        let outkiritop = codec.decode(topFromList);
        let outtop = outkiritop;
        out.push(number*100);
        out.push(data.number*100);
        reply({ seq, output: out, coded_slice, slice2, slice3, slice4, outtop });
    },

    clusterSupports: (data, seq) => {
        let { support_points, kn, bottom_z } = data; 
        let concave_cluster_hulls = [];

        function getSimplePointsArray(pointArray, fromSimple) { // simplify to array from point object, or to 2D array from 3D
            let simplePointsArray = [];
            if (fromSimple) {
                for (let i = 0; i < pointArray.length; i++) {
                    simplePointsArray.push([pointArray[i][0], pointArray[i][1]]);
                }
            } else {
                pointArray.forEach(function(point) {
                    simplePointsArray.push([point.x, point.y, point.z]);
                });  
            }
            return simplePointsArray;
        }    

        // Calculate clusters.
        var clusters;
        if (kn > 1) {
            var kmeans = kiri.newKMeans();
            clusters = kmeans.cluster(support_points, kn);
        }
        else {
            clusters = [support_points];
        }

        // get concave hull of clusters
        for (let cluster of clusters) {
            var cluster_2d = getSimplePointsArray(cluster, true);
            var new_hull = kiri.hull(cluster_2d, 100);

            let hull_points = [];

            for (let simplePoint of new_hull) {
                let point = newPoint(simplePoint[0], simplePoint[1], bottom_z);
                hull_points.push(point);
            }
            // hull_points.pop(); // First point equals last point, which is bad for making polys, but simplifies using this as a hull

            concave_cluster_hulls.push(hull_points);
        }
        reply({ seq, concave_cluster_hulls, kn });
    },

    surrogateClusterSearch: (data, seq) => {
        var optimizer = new kiri.Optimizer();
        let { slice_stack_data, surrogate_library, hull_points, susu_settings, device, widget } = data;
        console.log({slice_stack_data:slice_stack_data});
        console.log({surrogate_library:surrogate_library});
        console.log({hull_points:hull_points});
        console.log({susu_settings:susu_settings});
        console.log({device:device});
        console.log({widget:widget});

        /**
         * calculate and return the area enclosed by the polygon.
         * if raw is true, return a signed area equal to 2x the
         * enclosed area which also indicates winding direction.
         *
         * @param {boolean} [raw]
         * @returns {number} area
         */
        let copyArea = function(raw) {
            if (this.length < 3) {
                return 0;
            }
            if (this.area2 === undefined) {
                this.area2 = 0.0;
                for (let p = this.points, pl = p.length, pi = 0, p1, p2; pi < pl; pi++) {
                    p1 = p[pi];
                    p2 = p[(pi + 1) % pl];
                    this.area2 += (p2.x - p1.x) * (p2.y + p1.y);
                }
            }
            return raw ? this.area2 : Math.abs(this.area2 / 2);
        }

        /**
         * return the area of a polygon with the area of all
         * inner polygons subtracted
         *
         * @returns {number} area
         */
        let copyAreaDeep = function() {
            if (!this.inner) {
                return this.area();
            }
            let i, c = this.inner,
                a = this.area();
            for (i = 0; i < c.length; i++) {
                a -= c[i].area();
            }
            return a;
        }

        let mock_slice_list = [];
        for (let slice_data of slice_stack_data) {
            let mock_slice = codec.decode(slice_data[0]);

            for (let oneTop of slice_data[1]) {
                let oneDecodedTop = codec.decode(oneTop, {full: false});
                // console.log({oneDecodedTop:oneDecodedTop});
                // mock_slice.tops.push(codec.decode(oneTop, {full: true}));
                mock_slice.tops.push(oneDecodedTop);
            }

            // if (slice_data[2].length > 0) mock_slice.supports = [];
            // for (let oneSupport of slice_data[2]) {
            //     // let decodedSupport = codec.decode(oneSupport, {full: true});
            //     let decodedSupport = codec.decode(oneSupport);
            //     // decodedSupport.area = copyArea;
            //     // decodedSupport.areaDeep = copyAreaDeep;
            //     mock_slice.supports.push(decodedSupport);
            // }
            if (slice_data[2].length > 0) mock_slice.supports = codec.decode(slice_data[2]);

            mock_slice.height = slice_data[3];

            // else mock_slice.supports = [];
            mock_slice_list.push(mock_slice);
        }

        // Restore slices from decodede data
        let last_mock_slice;
        for (let mock_slice of mock_slice_list) {
            if (last_mock_slice) {
                mock_slice.down = last_mock_slice;
                last_mock_slice.up = mock_slice;
            }
            last_mock_slice = mock_slice;
        }
        console.log({mock_slice_list:mock_slice_list});

        let bottom_slice = mock_slice_list[0];
        susu_settings.all_slices = mock_slice_list;
        susu_settings.start_slice = bottom_slice;

        console.log({bottom_slice: bottom_slice});
        console.log({susu_settings:susu_settings});

        if (true)
        {
            console.log({status:("Threaded search starting handling starts: " + seq.toString())});
        }

        let surros = surrogate_library;
        let surrogate_settings = susu_settings;

        console.log({surrogate_settings:surrogate_settings});


        let minArea = surrogate_settings.supportMinArea,
            min = minArea || 0.01;
        // create inner clip offset from tops
        //POLY.expand(tops, offset, slice.z, slice.offsets = []);

        function getBestResult(optmizer_results) {
            let chosen_result = null;
            let highest_fitness = Number.NEGATIVE_INFINITY;
            for (let result of optmizer_results) {
                if (result.valid) {
                    if (result.fitness > highest_fitness) {
                        highest_fitness = result.fitness;
                        chosen_result = result;
                    }
                }
            }
            return chosen_result;
        }

        function getBestFittingSurrogateL2(surrogateList, desired_length, desired_width, desired_height) {
            let lowest_error = Infinity;
            let best_option = surrogateList[0];
            let idx = 0;
            let chosen_idx = 0;
            for (let surrogate of surrogateList) {
                let current_error = (surrogate.length - desired_length)**2 + (surrogate.width - desired_width)**2;
                if (desired_height > surrogate.maxHeight) {
                    current_error += (desired_height - surrogate.maxHeight)**2;
                } else if (desired_height < surrogate.minHeight) {
                    current_error += (desired_height - surrogate.minHeight)**2;
                }
                if (current_error < lowest_error) {
                    lowest_error = current_error;
                    best_option = surrogate;
                    chosen_idx = idx;
                }
                idx++;
            }
            return [ best_option, chosen_idx ];
        }

        function getSurrogateReplacedVolumes(old_volume, new_volume, current_slice, surrogate_rectangle_list) {
            let supports_after_surrogates = [];
            POLY.subtract(current_slice.supports, surrogate_rectangle_list, supports_after_surrogates, null, current_slice.z, 0);
            // if (supports_after_surrogates.length) {
            //     console.log({debugsupp:supports_after_surrogates[0]});
            //     console.log({debugsupp:supports_after_surrogates[0].areaDeep});
            //     console.log({debugsupp:supports_after_surrogates[0].areaDeep()});
            // }
            // console.log({surrogate_rectangle_list:surrogate_rectangle_list});
            // console.log({supports_after_surrogates:supports_after_surrogates});
            // console.log({current_slice:current_slice.supports});

            // let padded_debug = [];
            // if (supports_after_surrogates.length > 0) {
                
            //     // padded_debug = POLY.expand(supports_after_surrogates, 2, 0, padded_debug, 1);
            //     // if (!bottom_slice.tops[0].fill_sparse) bottom_slice.tops[0].fill_sparse = [];
            //     // for (let debug_index = 0; debug_index < padded_debug.length; debug_index++) {
            //     //     bottom_slice.tops[0].fill_sparse.push(padded_debug[debug_index]);
            //     // }
            // }

            // TODO: Fix this output to avoid spamming while out-of-bounds
            // else console.log({note:"There were 0 supports left"});

            let new_area = 0;
            let old_area = 0;

            supports_after_surrogates.forEach(function(supp) {
                new_volume += Math.abs((supp.areaDeep() * current_slice.height));
                new_area += Math.abs(supp.areaDeep());
            });
            
            current_slice.supports.forEach(function(supp) {
                old_volume += Math.abs((supp.areaDeep() * current_slice.height));
                old_area += Math.abs(supp.areaDeep());

                // if (!current_slice.tops[0].fill_sparse) current_slice.tops[0].fill_sparse = [];
                //current_slice.tops[0].fill_sparse.push(supp);
                
            });
            let delta_area = old_area - new_area;
            return [old_volume, new_volume, delta_area];
        }

        function generatePrismPolygon(start_x, start_y, start_z, geometry_points, rot, padding, debug_slice) {
            // TODO: Do poly generation while loading, if the points-level details are not necessary.

            // Must pad first, padding centers polygon as well somehow?

            const geometry_bounds_poly = base.newPolygon(geometry_points);
            // console.log({geometry_points:geometry_points});
            // console.log({geometry_bounds_poly:geometry_bounds_poly});
            const halfX = geometry_bounds_poly.bounds.maxx*0.5;
            const halfY = geometry_bounds_poly.bounds.maxy*0.5;
            
            // Translate based on try-out position
            for (let point_index = 0; point_index < geometry_points.length; point_index++) {
                // geometry_points[point_index].x += halfX;
                // geometry_points[point_index].y += halfY;
            }

            let rectanglePolygon = base.newPolygon(geometry_points);
            //rectanglePolygon.parent = top.poly;
            
            // console.log({rectanglePolygon:rectanglePolygon});
            rectanglePolygon = rectanglePolygon.rotateXY(rot);
            // console.log({rectanglePolygonP:rectanglePolygon});
  
            let rectanglePolygon_padded = [];
            rectanglePolygon_padded = POLY.expand([rectanglePolygon], padding, start_z, rectanglePolygon_padded, 1); 

            let translation_points_copy = rectanglePolygon_padded[0].points.clone();
            let after_padding_poly = base.newPolygon(translation_points_copy);
            let geometry_points2 = after_padding_poly.translatePoints(translation_points_copy, {x:start_x-halfX, y:start_y-halfY, z:start_z});

            let prismPolygon = base.newPolygon(geometry_points2);
            prismPolygon.depth = 0;
            prismPolygon.area2 = prismPolygon.area(true);


            // console.log({prismPolygon:prismPolygon});
            
            // if (!debug_slice.tops[0].fill_sparse) debug_slice.tops[0].fill_sparse = [];
            // debug_slice.tops[0].fill_sparse.push(prismPolygon);
            //debug_slice.tops[0].fill_sparse.push(rectanglePolygon);
            //debug_slice.tops[0].fill_sparse.push(rectanglePolygon_padded[0]);
            return prismPolygon;

        }

        // make test object polygons
        function generateRectanglePolygon(start_x, start_y, start_z, length, width, rot, padding, debug_slice) {
            let rotation = rot * Math.PI / 180;
            let point1 = newPoint(start_x, start_y, start_z);
            let point2 = newPoint(start_x + length*Math.cos(rotation), start_y + length*Math.sin(rotation), start_z);
            let point3 = newPoint(point2.x + width*Math.sin(-rotation), point2.y + width*Math.cos(-rotation), start_z);
            let point4 = newPoint(start_x + width*Math.sin(-rotation), start_y + width*Math.cos(-rotation), start_z);
            let rect_points = [point1, point2, point3, point4];
            let rectanglePolygon = base.newPolygon(rect_points);
            //rectanglePolygon.parent = top.poly;
            rectanglePolygon.depth = 0;
            // rectanglePolygon.area2 = length * width * 2;
            let rectanglePolygon_padded = [];
            rectanglePolygon_padded = POLY.expand([rectanglePolygon], padding, start_z, rectanglePolygon_padded, 1); 
            // console.log({rectanglePolygon:rectanglePolygon});
            // if (!debug_slice.tops[0].fill_sparse) debug_slice.tops[0].fill_sparse = [];
            // debug_slice.tops[0].fill_sparse.push(rectanglePolygon_padded[0]);
            return rectanglePolygon_padded[0];
        }

        // make test object polygons
        function generateRectanglePolygonCentered(start_x, start_y, start_z, length, width, rot, padding, debug_slice) {
            const halfLength = length*0.5;
            const halfWidth = width*0.5;
            let point1 = newPoint(start_x - halfLength, start_y - halfWidth, start_z);
            let point2 = newPoint(start_x + halfLength, start_y - halfWidth, start_z);
            let point3 = newPoint(start_x + halfLength, start_y + halfWidth, start_z);
            let point4 = newPoint(start_x - halfLength, start_y + halfWidth, start_z);
            let rect_points = [point1, point2, point3, point4];
            let rectanglePolygon = base.newPolygon(rect_points);
            rectanglePolygon = rectanglePolygon.rotateXY(rot);
            //rectanglePolygon.parent = top.poly;
            rectanglePolygon.depth = 0;
            rectanglePolygon.area2 = length * width * -2; // This winding direction is negative
            
            let rectanglePolygon_padded = [];
            rectanglePolygon_padded = POLY.expand([rectanglePolygon], padding, start_z, rectanglePolygon_padded, 1); 
            // console.log({rectanglePolygon:rectanglePolygon});
            // if (!debug_slice.tops[0].fill_sparse) debug_slice.tops[0].fill_sparse = [];
            // debug_slice.tops[0].fill_sparse.push(rectanglePolygon_padded[0]);
            return rectanglePolygon_padded[0];
        }

        function getSliceIndexList(precomputed_slice_heights, startHeight, endHeight) {
            let sliceIndexList = [];
            let skip = true;

            for (let sliceIndex = 0; sliceIndex < precomputed_slice_heights.length-1; sliceIndex++){
                if (skip && precomputed_slice_heights[sliceIndex].skipBelow >= startHeight) skip = false; // Start checking 
                if (precomputed_slice_heights[sliceIndex].stopAbove >= endHeight) break;
                if (!skip) sliceIndexList.push(sliceIndex);
            }
            // console.log({startHeight:startHeight, endHeight:endHeight});
            // console.log(sliceIndexList);
            return sliceIndexList;
        }

        function getStackableIndexList(precomputed_slice_heights, startHeight, addMaxNumber, addHeight) {
            let sliceIndexListList = [];
            let sliceIndexOneList = [];
            let skip = true;
            let counter = 1;
            let currentEndHeight = startHeight + addHeight;
            for (let sliceIndex = 0; sliceIndex < precomputed_slice_heights.length-1; sliceIndex++){
                if (skip && precomputed_slice_heights[sliceIndex].skipBelow >= startHeight) skip = false; // Start checking 
                if (precomputed_slice_heights[sliceIndex].stopAbove >= currentEndHeight) {
                    sliceIndexListList.push(sliceIndexOneList);
                    sliceIndexOneList = [sliceIndex];
                    currentEndHeight = currentEndHeight + addHeight;
                    counter += 1;
                    if (counter > addMaxNumber) break;
                }
                else if (!skip) sliceIndexOneList.push(sliceIndex);
            }
            for (let listsIdx = 0; listsIdx < sliceIndexListList.length; listsIdx++) {
                let reorderedList = []
                reorderedList.push(sliceIndexListList[listsIdx].shift()); // Add first and last layer
                reorderedList.push(sliceIndexListList[listsIdx].pop());

                shuffleArray(sliceIndexListList[listsIdx]);
                reorderedList.push(...sliceIndexListList[listsIdx]);
                sliceIndexListList[listsIdx] = reorderedList;
            }
            return sliceIndexListList;
        }

        function shuffleArray(array) {
            for (let i = array.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [array[i], array[j]] = [array[j], array[i]];
            }
        }

        function reorderSliceIndexList(inputList, skimPercentage) {
            let sliceIndexList = [...inputList];
            if (sliceIndexList.length < 3) return sliceIndexList;
            let reorderedSkimmedList = [];
            reorderedSkimmedList.push(sliceIndexList.shift()); // Add first and last layer
            reorderedSkimmedList.push(sliceIndexList.pop());
            let targetCount = Math.ceil(sliceIndexList.length * skimPercentage);
            if (targetCount > sliceIndexList.length) targetCount -= 1;

            shuffleArray(sliceIndexList);
            let remainderList = [...sliceIndexList];
            remainderList = remainderList.slice(targetCount-1, remainderList.length);
            sliceIndexList = sliceIndexList.slice(0, targetCount-1);
            reorderedSkimmedList.push(...sliceIndexList);

            return [reorderedSkimmedList, remainderList];
        }

        function getTotalSupportVolume(bottom_slice) {
            let iterate_layers_support = bottom_slice;
            let total_support_volume = 0;
            let total_support_area = 0;
            while (iterate_layers_support) {
                if (iterate_layers_support.supports) {
                    iterate_layers_support.supports.forEach(function(supp) {
                        total_support_area += supp.areaDeep();
                        total_support_volume += Math.abs((supp.areaDeep() * iterate_layers_support.height));
                    });
                }
                iterate_layers_support = iterate_layers_support.up;
            }
            return [total_support_volume, total_support_area];
        }

        function checkVolumeAndCollisions(surrogate_library, surrogate_settings, bottom_slice, try_surro_index, try_surro_polygons_list, try_z, surrogates_placed) {
            console.log({try_surro_polygons_list:try_surro_polygons_list});
            let collision = false;
            let overextended = false;
            let iterate_layers_VandC = bottom_slice;
            let try_surro = surrogate_library[try_surro_index];
            let new_volume = 0;
            let old_volume = 0;

            let last_collision_area = 0;
            let max_surrogated_area = 0;
            // TODO: Make try_surro_polygons_list here, or generate only once and translate+rotate instead

            // Check for collision for the whole surrogate height
            while (iterate_layers_VandC && overextended === false) { // && collision === false ) { // Stop after first collision found, or end of widget reached
                
                // Increase height until surrogate starting height is reached 
                // Approximation: If more than half of the slice height is surrogated, we count it fully (for volume) #TODO: for collisions we might want to check for ANY overlap
                if (iterate_layers_VandC.z < try_z) { // LWW TODO: Check at what height we actually want to start checking for collisions
                    iterate_layers_VandC = iterate_layers_VandC.up;
                    // console.log({going_up: "Going up because surro is not on buildplate!"});
                    continue;
                }

                

                // DON'T skip the layers, since we are looking for model polygons and previous surrogate supports
                // Skip layers without support
                // if (!iterate_layers_VandC.supports || iterate_layers_VandC.supports.length === 0) {
                //     iterate_layers_VandC = iterate_layers_VandC.up;
                //     console.log({going_up: "No support to check for collision found on this slice"});
                //     continue;
                // }


                let calculating_volume = true;
                let check_collisions = true;
                // let slice_height_range = get_height_range(iterate_layers_VandC);
                

                // Skip volume count for layers that have no supports
                if (!iterate_layers_VandC.supports || iterate_layers_VandC.supports.length === 0) {
                    calculating_volume = false;
                }
                // Stop counting volume once surrogate height has passed AND
                // stop checking collisions when surrogate top is higher than slice bottom + min squish height 
                // else if ((slice_height_range.bottom_height + surrogate_settings.min_squish_height) >= (try_surro.maxHeight + try_z)){
                else if ((iterate_layers_VandC.z - surrogate_settings.min_squish_height) >= (try_surro.maxHeight + try_z)){    
                    calculating_volume = false;
                    check_collisions = false;
                }
                
                // if ((slice_height_range.bottom_height + surrogate_settings.min_squish_height) >= (try_surro.maxHeight + try_z)) { 
                // if ((iterate_layers_VandC.z - surrogate_settings.min_squish_height) >= (try_surro.maxHeight + try_z)) {
                //     check_collisions = false;
                // }

                // TODO: Remove if unnecessary
                if (collision) check_collisions = false;
                
                if (calculating_volume) {
                    const volumes = getSurrogateReplacedVolumes(old_volume, new_volume, iterate_layers_VandC, try_surro_polygons_list);
                    old_volume = volumes[0];
                    new_volume = volumes[1];
                    if (max_surrogated_area < volumes[2]) max_surrogated_area = volumes[2];
                }

                if (check_collisions) {
                    console.log(iterate_layers_VandC.index);
                    let collision_detection = [];
                    POLY.subtract(iterate_layers_VandC.topPolys(), try_surro_polygons_list, collision_detection, null, iterate_layers_VandC.z, min);
                    // console.log({try_surro_polygons_list:try_surro_polygons_list});
                    
                    let post_collision_area = 0, pre_collision_area = 0;
                    iterate_layers_VandC.topPolys().forEach(function(top_poly) {
                        pre_collision_area += Math.abs(top_poly.areaDeep());
                    });
                    collision_detection.forEach(function(top_poly) {
                        post_collision_area += Math.abs(top_poly.areaDeep());
                    });
                    
                    if ((pre_collision_area - post_collision_area) > 0.00001) { // rounded the same // TODO: Currently testing whether we need Math abs with switched subtraction order
                        // if ((slice_height_range.bottom_height + surrogate_settings.min_squish_height) < (try_surro.minHeight + try_z)) {
                        if ((iterate_layers_VandC.z - surrogate_settings.min_squish_height) < (try_surro.minHeight + try_z)) {
                            collision = true;
                            last_collision_area = pre_collision_area - post_collision_area;
                            continue;
                        }
                        else {
                            try_surro.height = iterate_layers_VandC.down.z; // TODO: Test whether this is the best previous height
                            overextended = true;
                            continue;
                        }
                        //console.log({collision_true: post_collision_area - pre_collision_area});
                    }

                    // Check collision with already placed surrogates as well
                    
                    if (surrogates_placed.length >= 1) {
                        
                        for (let surrogates_placed_idx = 0; surrogates_placed_idx < surrogates_placed.length; surrogates_placed_idx++) {
                            let previous_surrogate = surrogates_placed[surrogates_placed_idx];

                            // (previous_surrogate.surro.height + previous_surrogate.starting_height)
                            if (iterate_layers_VandC.z <= (previous_surrogate.end_height) && iterate_layers_VandC.z >= previous_surrogate.starting_height) {

                                collision_detection = [];
                                
                                POLY.subtract(try_surro_polygons_list, previous_surrogate.geometry, collision_detection, null, iterate_layers_VandC.z, min); // TODO: Check if Z matters
                                
                                post_collision_area = 0;
                                pre_collision_area = 0;
                                try_surro_polygons_list.forEach(function(top_poly) {
                                    pre_collision_area += Math.abs(top_poly.areaDeep());
                                });
                                collision_detection.forEach(function(top_poly) {
                                    post_collision_area += Math.abs(top_poly.areaDeep());
                                });
                                
                                if ((pre_collision_area - post_collision_area) > 0.00001) {
                                    // if ((slice_height_range.bottom_height + surrogate_settings.min_squish_height) < (try_surro.minHeight + try_z)) {
                                    if ((iterate_layers_VandC.z - surrogate_settings.min_squish_height) < (try_surro.minHeight + try_z)) {
                                        collision = true;
                                        last_collision_area = pre_collision_area - post_collision_area;
                                        continue;
                                    }
                                    else {
                                        try_surro.height = iterate_layers_VandC.down.z; // TODO: Test whether this is the best previous height
                                        overextended = true;
                                        continue;
                                    }
                                    //console.log({collision_true: post_collision_area - pre_collision_area});
                                }
                            }
                        }
                    }
                }

                // Out of range of surrogate, nothing left to do
                if (check_collisions === false && calculating_volume === false) {
                    // repetition_counter++;
                    break;
                }

                // Step up
                iterate_layers_VandC = iterate_layers_VandC.up;
                // insertion_layer_number_guess = iterate_layers_VandC.index;
            }
            if (collision) {
                // good = false;
                // repetition_counter++;

                // let negative_volume = last_collision_area * -1;
                // return [collision, negative_volume, negative_volume];
            }

            // let overlap_factor = last_collision_area / max_surrogated_area;
            // if (overlap_factor > 1) overlap_factor = 1.0;
        
            return [collision, old_volume, new_volume, last_collision_area, max_surrogated_area];//overlap_factor]
        }

        function checkVolumeAndCollisionsListQuick(all_slices, sliceIndexList, numberOfTotalSlices, try_surro_polygons_list, surrogates_placed) {
            let collision = false;

            let new_volume = 0;
            let old_volume = 0;

            // let total_collision_area = 0;

            let max_collision_area = 0;

            let max_surrogated_area = 0;
            // let collisions_found = 0;

            // TODO: Make try_surro_polygons_list here, or generate only once and translate+rotate instead

            for (let indexIndex = 0; indexIndex < sliceIndexList.length; indexIndex++) {
                let current_slice = all_slices[sliceIndexList[indexIndex]];
            
                let calculating_volume = true;
                
                // Skip volume count for layers that have no supports
                if (!current_slice.supports || current_slice.supports.length === 0) {
                    calculating_volume = false;
                }

                if (calculating_volume) {
                    const volumes = getSurrogateReplacedVolumes(old_volume, new_volume, current_slice, try_surro_polygons_list);
                    // console.log({volumes:volumes});
                    old_volume = volumes[0];
                    new_volume = volumes[1];
                    if (max_surrogated_area < volumes[2]) max_surrogated_area = volumes[2];
                }

                // console.log(current_slice.index);
                let collision_detection = [];
                POLY.subtract(current_slice.topPolys(), try_surro_polygons_list, collision_detection, null, current_slice.z, 0.05);
                // console.log({try_surro_polygons_list:try_surro_polygons_list});
                
                let post_collision_area = 0, pre_collision_area = 0;
                current_slice.topPolys().forEach(function(top_poly) {
                    pre_collision_area += Math.abs(top_poly.areaDeep());
                });
                collision_detection.forEach(function(top_poly) {
                    post_collision_area += Math.abs(top_poly.areaDeep());
                });

                const collision_area = pre_collision_area - post_collision_area;
                // if (collision_area < -0.00000001) {
                //     console.log({WARNING:"AAAAAAAAAAA ABS NEEDED"});
                //     console.log({collision_area:collision_area});
                // }
                
                if (collision_area > 0.00001) { // rounded the same // TODO: Currently testing whether we need Math abs with switched subtraction order
                    // if ((slice_height_range.bottom_height + surrogate_settings.min_squish_height) < (try_surro.minHeight + try_z)) {
                    // total_collision_area += collision_area;
                    collision = true;
                    // collisions_found += 1;
                    if (max_collision_area < collision_area) max_collision_area = collision_area;
                }

                // Check collision with already placed surrogates as well
                
                if (surrogates_placed.length >= 1) {
                    
                    for (let surrogates_placed_idx = 0; surrogates_placed_idx < surrogates_placed.length; surrogates_placed_idx++) {
                        let previous_surrogate = surrogates_placed[surrogates_placed_idx];

                        // (previous_surrogate.surro.height + previous_surrogate.starting_height)
                        if (current_slice.z <= (previous_surrogate.end_height) && current_slice.z >= previous_surrogate.starting_height) {

                            collision_detection = [];
                            
                            POLY.subtract(try_surro_polygons_list, previous_surrogate.geometry, collision_detection, null, current_slice.z, 0.05); // TODO: Check if Z matters
                            
                            post_collision_area = 0;
                            pre_collision_area = 0;
                            try_surro_polygons_list.forEach(function(top_poly) {
                                pre_collision_area += Math.abs(top_poly.areaDeep());
                            });
                            collision_detection.forEach(function(top_poly) {
                                post_collision_area += Math.abs(top_poly.areaDeep());
                            });

                            const collision_area_other_surrogates = pre_collision_area - post_collision_area;
                            // if (collision_area_other_surrogates < -0.00000001) {
                            //     console.log({WARNING:"AAAAAAAAAAA ABS NEEDED"});
                            //     console.log({collision_area_other_surrogates:collision_area_other_surrogates});
                            // }
                            
                            if ((collision_area_other_surrogates) > 0.00001) {
                                // total_collision_area += collision_area_other_surrogates;
                                collision = true;
                                // collisions_found += 1;
                                if (max_collision_area < collision_area_other_surrogates) max_collision_area = collision_area_other_surrogates;
                            }
                        }
                    }
                }
            }

            const delta_volume = old_volume - new_volume;
            const delta_volume_estimate = (delta_volume / sliceIndexList.length) * numberOfTotalSlices;
            // console.log({sliceIndexListLength:sliceIndexList.length});
            // console.log({numberOfTotalSlices:numberOfTotalSlices});
            // console.log({delta_volume_estimate:delta_volume_estimate});
            // console.log({delta_volume:delta_volume});
            
            const collisions_found = 0;
            return [collision, delta_volume_estimate, max_collision_area, delta_volume, max_surrogated_area, collisions_found];
        }

        function checkVolumeAndCollisionsRemaining(all_slices, sliceIndexList, try_surro_polygons_list, surrogates_placed) {
            let collision = false;

            let new_volume = 0;
            let old_volume = 0;

            let max_collision_area = 0;
            // let total_collision_area = 0;

            let checked_layers = 0;
            let max_surrogated_area = 0;
            // let collisions_found = 0;

            // TODO: Make try_surro_polygons_list here, or generate only once and translate+rotate instead

            for (let indexIndex = 0; indexIndex < sliceIndexList.length; indexIndex++) {

                let current_slice = all_slices[sliceIndexList[indexIndex]];
                checked_layers += 1;

                let calculating_volume = true;
                
                // Skip volume count for layers that have no supports
                if (!current_slice.supports || current_slice.supports.length === 0) {
                    calculating_volume = false;
                }
             
                if (calculating_volume) {
                    const volumes = getSurrogateReplacedVolumes(old_volume, new_volume, current_slice, try_surro_polygons_list);
                    old_volume = volumes[0];
                    new_volume = volumes[1];
                    if (max_surrogated_area < volumes[2]) max_surrogated_area = volumes[2];
                }

                // console.log(current_slice.index);
                let collision_detection = [];
                POLY.subtract(current_slice.topPolys(), try_surro_polygons_list, collision_detection, null, current_slice.z, 0.05);
                // console.log({try_surro_polygons_list:try_surro_polygons_list});
                
                let post_collision_area = 0, pre_collision_area = 0;
                current_slice.topPolys().forEach(function(top_poly) {
                    pre_collision_area += Math.abs(top_poly.areaDeep());
                });
                collision_detection.forEach(function(top_poly) {
                    post_collision_area += Math.abs(top_poly.areaDeep());
                });

                const collision_area = pre_collision_area - post_collision_area;
                // if (collision_area < -0.00000001) {
                //     console.log({WARNING:"AAAAAAAAAAA ABS NEEDED"});
                //     console.log({collision_area:collision_area});
                // }
                
                if ((collision_area) > 0.00001) { // rounded the same 
                    // total_collision_area += collision_area;
                    collision = true;
                    // collisions_found += 1;
                    if (max_collision_area < collision_area) max_collision_area = collision_area;
                }

                // ------
                // The quick check SHOULD find all collision with already placed surrogates already
                // ------

                // if (surrogates_placed.length >= 1) {
                    
                //     for (let surrogates_placed_idx = 0; surrogates_placed_idx < surrogates_placed.length; surrogates_placed_idx++) {

                //         let previous_surrogate = surrogates_placed[surrogates_placed_idx];

                //         // (previous_surrogate.surro.height + previous_surrogate.starting_height)
                //         if (current_slice.z <= (previous_surrogate.end_height) && current_slice.z >= previous_surrogate.starting_height) {

                //             collision_detection = [];
                            
                //             POLY.subtract(try_surro_polygons_list, previous_surrogate.geometry, collision_detection, null, current_slice.z, 0.05); // TODO: Check if Z matters
                            
                //             post_collision_area = 0;
                //             pre_collision_area = 0;
                //             try_surro_polygons_list.forEach(function(top_poly) {
                //                 pre_collision_area += Math.abs(top_poly.areaDeep());
                //             });
                //             collision_detection.forEach(function(top_poly) {
                //                 post_collision_area += Math.abs(top_poly.areaDeep());
                //             });

                //             const collision_area_other_surrogates = pre_collision_area - post_collision_area;
                //             // if (collision_area_other_surrogates < -0.00000001) {
                //             //     console.log({WARNING:"AAAAAAAAAAA ABS NEEDED"});
                //             //     console.log({collision_area_other_surrogates:collision_area_other_surrogates});
                //             // }
                                                        
                //             if ((collision_area_other_surrogates) > 0.00001) {
                //                 console.log({collision_area_other_surrogates:collision_area_other_surrogates});
                //                 console.log({Note:"This part is not skippable after all"});
                //                 // total_collision_area += collision_area_other_surrogates;
                //                 collision = true;
                //                 // collisions_found += 1;
                //                 if (max_collision_area < collision_area_other_surrogates) max_collision_area = collision_area_other_surrogates;
                //             }
                //         }
                //     }
                // }
                
                if (collision) break;
            }

            const delta_volume = old_volume - new_volume;

            // console.log({checked_layers:checked_layers});
            // console.log({delta_volume_remaining:delta_volume});
            const collisions_found = 0;
       
            return [collision, 0, max_collision_area, delta_volume, max_surrogated_area, collisions_found, checked_layers];
        }

        function checkVolumeAndCollisionsExtend(all_slices, sliceIndexList, try_surro_polygons_list, defaultHeight) {
            let new_volume = 0;
            let old_volume = 0;

            let current_slice = undefined;
            let lastSlice = undefined;

            let foundMaxHeight = defaultHeight;

            for (let indexIndex = 0; indexIndex < sliceIndexList.length; indexIndex++) {
                lastSlice = current_slice;
                current_slice = all_slices[sliceIndexList[indexIndex]];

                // Stop extending if there is no support
                if (!current_slice.supports || current_slice.supports.length === 0) {
                    break;
                }
             
                const volumes = getSurrogateReplacedVolumes(old_volume, new_volume, current_slice, try_surro_polygons_list);
                old_volume = volumes[0];
                new_volume = volumes[1];

                // console.log(current_slice.index);
                let collision_detection = [];
                POLY.subtract(current_slice.topPolys(), try_surro_polygons_list, collision_detection, null, current_slice.z, 0.05);
                // console.log({try_surro_polygons_list:try_surro_polygons_list});
                
                let post_collision_area = 0, pre_collision_area = 0;
                current_slice.topPolys().forEach(function(top_poly) {
                    pre_collision_area += Math.abs(top_poly.areaDeep());
                });
                collision_detection.forEach(function(top_poly) {
                    post_collision_area += Math.abs(top_poly.areaDeep());
                });

                const collision_area = pre_collision_area - post_collision_area;
                // if (collision_area < -0.00000001) {
                //     console.log({WARNING:"AAAAAAAAAAA ABS NEEDED"});
                //     console.log({collision_area:collision_area});
                // }
                
                if ((collision_area) > 0.00001) { // rounded the same 
                    break;
                }

                // ------
                // The quick check SHOULD find all collision with already placed surrogates already
                // ------

                // if (surrogates_placed.length >= 1) {
                    
                //     for (let surrogates_placed_idx = 0; surrogates_placed_idx < surrogates_placed.length; surrogates_placed_idx++) {

                //         let previous_surrogate = surrogates_placed[surrogates_placed_idx];

                //         if (current_slice.z <= (previous_surrogate.surro.height + previous_surrogate.starting_height) && current_slice.z >= previous_surrogate.starting_height) {

                //             collision_detection = [];
                            
                //             POLY.subtract(try_surro_polygons_list, previous_surrogate.geometry, collision_detection, null, current_slice.z, 0.05); // TODO: Check if Z matters
                            
                //             post_collision_area = 0;
                //             pre_collision_area = 0;
                //             try_surro_polygons_list.forEach(function(top_poly) {
                //                 pre_collision_area += Math.abs(top_poly.areaDeep());
                //             });
                //             collision_detection.forEach(function(top_poly) {
                //                 post_collision_area += Math.abs(top_poly.areaDeep());
                //             });

                //             const collision_area_other_surrogates = pre_collision_area - post_collision_area;
                //             if (collision_area_other_surrogates < -0.00000001) {
                //                 console.log({WARNING:"AAAAAAAAAAA ABS NEEDED"});
                //                 console.log({collision_area_other_surrogates:collision_area_other_surrogates});
                //             }
                                                        
                //             if ((collision_area_other_surrogates) > 0.00001) {
                //                 console.log({collision_area_other_surrogates:collision_area_other_surrogates});
                //                 console.log({Note:"This part is not skippable after all"});
                //                 // total_collision_area += collision_area_other_surrogates;
                //                 collision = true;
                //                 // collisions_found += 1;
                //                 if (max_collision_area < collision_area_other_surrogates) max_collision_area = collision_area_other_surrogates;
                //             }
                //         }
                //     }
                // }
            }

            if (lastSlice) {
                foundMaxHeight = lastSlice.z + (lastSlice.height * 0.49); // TODO make it directly on the layer intersection? Check for case handling issues
            }

            const delta_volume = old_volume - new_volume;

            // console.log({checked_layers:checked_layers});
            // console.log({delta_volume_remaining:delta_volume});
       
            return [foundMaxHeight, delta_volume];
        }

        function checkVolumeAndCollisionsStack(all_slices, sliceIndexListList, try_surro_polygons_list, defaultHeight, addHeight) {
            let new_volume = 0;
            let old_volume = 0;

            let foundMaxHeight = defaultHeight;

            let counter = 1;
            for (let indexIndexI = 0; indexIndexI < sliceIndexListList.length; indexIndexI++) {
                const sliceIndexList = sliceIndexListList[indexIndexI];
                let issueFound = false;
                let extraVolOld = 0;
                let extraVolNew = 0;
                for (let indexIndex = 0; indexIndex < sliceIndexList.length; indexIndex++) {
                    let current_slice = all_slices[sliceIndexList[indexIndex]];

                    // Stop extending if there is no support
                    if (!current_slice.supports || current_slice.supports.length === 0) {
                        issueFound = true;
                        break;
                    }
                
                    const volumes = getSurrogateReplacedVolumes(extraVolOld, extraVolNew, current_slice, try_surro_polygons_list);
                    extraVolOld = volumes[0];
                    extraVolNew = volumes[1];

                    // console.log(current_slice.index);
                    let collision_detection = [];
                    POLY.subtract(current_slice.topPolys(), try_surro_polygons_list, collision_detection, null, current_slice.z, 0.05);
                    // console.log({try_surro_polygons_list:try_surro_polygons_list});
                    
                    let post_collision_area = 0, pre_collision_area = 0;
                    current_slice.topPolys().forEach(function(top_poly) {
                        pre_collision_area += Math.abs(top_poly.areaDeep());
                    });
                    collision_detection.forEach(function(top_poly) {
                        post_collision_area += Math.abs(top_poly.areaDeep());
                    });

                    const collision_area = pre_collision_area - post_collision_area;
                    // if (collision_area < -0.00000001) {
                    //     console.log({WARNING:"AAAAAAAAAAA ABS NEEDED"});
                    //     console.log({collision_area:collision_area});
                    // }
                    
                    if ((collision_area) > 0.00001) { // rounded the same 
                        issueFound = true;
                        break;
                    }

                    // ------
                    // The quick check SHOULD find all collision with already placed surrogates already
                    // ------

                    // if (surrogates_placed.length >= 1) {
                        
                    //     for (let surrogates_placed_idx = 0; surrogates_placed_idx < surrogates_placed.length; surrogates_placed_idx++) {

                    //         let previous_surrogate = surrogates_placed[surrogates_placed_idx];

                    //         if (current_slice.z <= (previous_surrogate.surro.height + previous_surrogate.starting_height) && current_slice.z >= previous_surrogate.starting_height) {

                    //             collision_detection = [];
                                
                    //             POLY.subtract(try_surro_polygons_list, previous_surrogate.geometry, collision_detection, null, current_slice.z, 0.05); // TODO: Check if Z matters
                                
                    //             post_collision_area = 0;
                    //             pre_collision_area = 0;
                    //             try_surro_polygons_list.forEach(function(top_poly) {
                    //                 pre_collision_area += Math.abs(top_poly.areaDeep());
                    //             });
                    //             collision_detection.forEach(function(top_poly) {
                    //                 post_collision_area += Math.abs(top_poly.areaDeep());
                    //             });

                    //             const collision_area_other_surrogates = pre_collision_area - post_collision_area;
                    //             if (collision_area_other_surrogates < -0.00000001) {
                    //                 console.log({WARNING:"AAAAAAAAAAA ABS NEEDED"});
                    //                 console.log({collision_area_other_surrogates:collision_area_other_surrogates});
                    //             }
                                                            
                    //             if ((collision_area_other_surrogates) > 0.00001) {
                    //                 console.log({collision_area_other_surrogates:collision_area_other_surrogates});
                    //                 console.log({Note:"This part is not skippable after all"});
                    //                 // total_collision_area += collision_area_other_surrogates;
                    //                 collision = true;
                    //                 // collisions_found += 1;
                    //                 if (max_collision_area < collision_area_other_surrogates) max_collision_area = collision_area_other_surrogates;
                    //             }
                    //         }
                    //     }
                    // }
                }
                if (issueFound) { // This iteration had a problem, stop going higher
                    break;
                }
                else { // Add successfull stack addition to data
                    foundMaxHeight += addHeight; // For next iteration
                    counter += 1; // For next iteration
                    old_volume += extraVolOld; // This iteration
                    new_volume += extraVolNew; // This iteration
                }
            }

            const delta_volume = old_volume - new_volume;

            // console.log({checked_layers:checked_layers});
            // console.log({delta_volume_remaining:delta_volume});
       
            return [foundMaxHeight, delta_volume, counter];
        }

        // function simple_insertion_case_check(surrogate, precomputed_slice_heights) {
        //     for (let sliceIndex = 0; sliceIndex < precomputed_slice_heights.length-1; sliceIndex++){
        //         if (precomputed_slice_heights[sliceIndex].stopAbove >= surrogate.end_height) {
        //             surrogate.insertion_data.new_layer_index = sliceIndex;
        //             break;
        //         }
        //     }
        // }
    

        //console.log({support_area: support_area});

        // let test_surro_rectangle_list = [generateRectanglePolygonCentered(0, -20, slice.z, 5, 30, 0.0)];
        // test_surro_rectangle_list.push(generateRectanglePolygonCentered(0, 10, slice.z, 2, 2, 0));
        // test_surro_rectangle_list.push(generateRectanglePolygonCentered(0, 15, slice.z, 2, 2, 0));
        // test_surro_rectangle_list.push(generateRectanglePolygonCentered(0, 20, slice.z, 2, 2, 0));
        // let test_surro_rectangle_list = [];
        // let support_area = 0;
        // let otherWidget;

        // while (bottom_slice) {
        //     last_bottom_slice = bottom_slice;
        //     bottom_slice = bottom_slice.down;
        //     // if (!otherWidget) { // The second widget has the manual support pillars 
        //     //     try {
        //     //         const thisWidgetID =  widget.id;
        //     //         for (let widInd = 0; widInd <  widget.group.length; widInd +=1 ) {
        //     //             if ( widget.group[widInd].id != thisWidgetID)  {
        //     //                 otherWidget =  widget.group[widInd]; // Get widget with manual supports
        //     //                 break;
        //     //             }
        //     //         }
        //     //     }
        //     //     catch { } // We don't care if there is none
        //     // }
        // }

        // bottom_slice = last_bottom_slice;
        
        

        // let coff = new ClipperLib.ClipperOffset(opts.miter, opts.arc);
        // let coffTest = new ClipperLib.ClipperOffset(undefined, undefined);
 
        // let surrogate_settings = {};

        let surrogate_number_goal;

        // if (proc.surrogateInteraction == "off") {
        //     surrogate_number_goal = 0;
        // } else if(proc.surrogateInteraction == "low") {
        //     surrogate_number_goal = 4;
        // } else if(proc.surrogateInteraction == "medium") {
        //     surrogate_number_goal = 5;
        // } else if(proc.surrogateInteraction == "high") {
        //     surrogate_number_goal = 7;
        // }


        if (surrogate_settings.surrogateInteraction == "off") {
            surrogate_number_goal = 0;
        } 
        else {
            surrogate_number_goal = 1;
        }

        let search_padding = 20; // TODO: Adjust to size of surrogate/largest surrogate?
        // Search bounds
        const min_x =  widget.bounds.min.x - search_padding;
        const max_x =  widget.bounds.max.x + search_padding;
        const min_y =  widget.bounds.min.y - search_padding;
        const max_y =  widget.bounds.max.y + search_padding;
        const bedDepthArea = device.bedDepth / 2;
        const bedWidthArea = device.bedWidth / 2;
        const shift_x =  widget.track.pos.x;
        const shift_y =  widget.track.pos.y;

        console.log({bedDepthArea:bedDepthArea});
        console.log({bedWidthArea:bedWidthArea});

        console.log({shift_x:shift_x});
        console.log({shift_y:shift_y});
        
        let surrogates_placed = [];
        let try_x = 0;
        let try_y = 0;
        let try_z = 0;
        let try_rotation = 0;
        let try_surro = 0;

        let pre_surrogate_support_amounts = getTotalSupportVolume(bottom_slice);

        // console.log({pause_layers_start: settings.process.gcodePauseLayers});

        console.log({min_x:min_x});
        console.log({max_x:max_x});
        console.log({min_y:min_y});
        console.log({max_y:max_y});

        const log = function () { console.log(arguments); };
        
        // Optimizer search

        // Optimizer area ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
        let valid_answers = [];
        var optimizer = new kiri.Optimizer();
        optimizer.surrogate_library = surros;
        optimizer.surrogate_settings = surrogate_settings;
        console.log({optSet:optimizer.surrogate_settings});
        console.log({surrogate_settings:surrogate_settings});
        optimizer.valid_answers = [];
        // set the objective function
        optimizer.setObjectiveFunction(function (var_list, done) { 
            // if (var_list[0] < 1) var_list[0] = 1.0;

            // placeAndEval function, original source
            let all_surrogates = [];
            for (old_surrogate of this.surrogate_settings.existing_surrogates) {
                all_surrogates.push(old_surrogate);
            };
            let results_array = [];

            let overlap_factor = 0;

            let candidate;
            let results_meta_data = {valid:false, candidate_details:null, fitness:Number.NEGATIVE_INFINITY, tower_size:1, below:null, aboves:[]};

            let pso_use_this_surrogate = 0;
            let tower_details = {tower_x:null, tower_y:null};

            // Name parameters for easy handling
            let chosen_x = var_list[0];
            let chosen_y = var_list[1];
            let chosen_rotation = var_list[2];
            let pso_desired_length = var_list[3];
            let pso_desired_width = var_list[4];
            let pso_desired_height = var_list[5];

            let [ pso_surrogate, pso_idx ] = getBestFittingSurrogateL2(this.surrogate_library, pso_desired_length, pso_desired_width, pso_desired_height);

            let pso_z = 0;
            
            // generate polygons // TODO: Is it faster to make one poly for the surrogate and then rotate+translate /modify the points directly?
            let pso_polygons_list = [];
            if (pso_surrogate.type == "simpleRectangle" || pso_surrogate.type == "stackable") {
                pso_polygons_list = [generateRectanglePolygon(chosen_x, chosen_y, pso_z, pso_surrogate.length, pso_surrogate.width, chosen_rotation, surrogate_settings.surrogate_padding, this.surrogate_settings.start_slice)];
            }
            else if (pso_surrogate.type == "prism") {
                pso_polygons_list = [generatePrismPolygon(chosen_x, chosen_y, pso_z, pso_surrogate.prism_geometry, chosen_rotation, surrogate_settings.surrogate_padding, this.surrogate_settings.start_slice)];
            }

            let oob = false;

            // Out of build-area check
            for (let pso_poly of pso_polygons_list) {
                // translate widget coordinate system to build plate coordinate system and compare with build plate size (center is at 0|0, bottom left is at -Width/2|-Depth/2)
                if (pso_poly.bounds.maxx + shift_x > bedWidthArea || pso_poly.bounds.minx + shift_x < -bedWidthArea || pso_poly.bounds.maxy + shift_y > bedDepthArea || pso_poly.bounds.miny + shift_y < -bedDepthArea || pso_z + pso_surrogate.height > device.bedDepth) {
                    // console.log(pso_poly.bounds.maxx);
                    // console.log(pso_poly.bounds.minx);
                    // console.log(pso_poly.bounds.maxy);
                    // console.log(pso_poly.bounds.miny);
                    // console.log("eh");
                    // TODO: save for return later the negative size of overlap for this test part?
                    oob = true;
                }
            }

            if (oob) {
                let fitness = 0;
                done(fitness);
            } else {                
                const sliceIndexList = getSliceIndexList(this.surrogate_settings.precomputed_slice_heights, pso_z, pso_z + pso_surrogate.minHeight)
                let splitLists = reorderSliceIndexList(sliceIndexList, this.surrogate_settings.skimPercentage);
                let quickList = splitLists[0];
                let remainderList = splitLists[1];

                //   var_list[7] = 0;
                // pso_use_this_surrogate = 0;

                // let pso_collision_and_volumes = checkVolumeAndCollisions(this.surrogate_library, this.surrogate_settings, this.surrogate_settings.start_slice, library_index, pso_polygons_list, pso_z, all_surrogates);
                let pso_collision_and_volumes = checkVolumeAndCollisionsListQuick(this.surrogate_settings.all_slices, quickList, sliceIndexList.length, pso_polygons_list, all_surrogates);
                // console.log({pso_collision_and_volumes:pso_collision_and_volumes});
                // const delta_volume = pso_collision_and_volumes[1] - pso_collision_and_volumes[2];
                let delta_volume_estimate = pso_collision_and_volumes[1];
                if (pso_surrogate.type != "simpleRectangle") delta_volume_estimate = delta_volume_estimate * pso_surrogate.maxHeight / pso_surrogate.minHeight; // Stretch estimate to max height
                if (delta_volume_estimate > this.surrogate_settings.minVolume) {
                    // console.log({delta_volume_estimate:delta_volume_estimate});
                    
                    // console.log({pso_collision_and_volumes:pso_collision_and_volumes});
                    if (pso_collision_and_volumes[0] === true) { // Collision in quick check found: Use estimate as collided area after reducing by overlap factor.
                        //   var_list[7] = 0;

                        overlap_factor = (pso_collision_and_volumes[2] / (pso_collision_and_volumes[4]));
                        if (overlap_factor > 1 || isNaN(overlap_factor)) overlap_factor = 1.0;
                        pso_collision_and_volumes[3] = delta_volume_estimate * (1-overlap_factor); // Scale estimate by collision severity
                        // if (overlap_factor < smallest_overlap_factor) smallest_overlap_factor = overlap_factor;
                        // average_overlap_factor = overlap_factor;
                        // overlap_counter += pso_collision_and_volumes[5];
                        // overlap_counter += 1;
                    }

                    else { // No collision yet
                        // save successful candidate // TODO: (and validation insertion case and layer)
                        // if (good_tower) console.log({Note:"Good tower and no collision YET"});

                        if (delta_volume_estimate > (this.surrogate_settings.average_so_far * this.surrogate_settings.exploration_factor)) {

                            let pso_collision_and_volumes_remaining = checkVolumeAndCollisionsRemaining(this.surrogate_settings.all_slices, remainderList, pso_polygons_list, all_surrogates);
                            pso_collision_and_volumes[0] = pso_collision_and_volumes_remaining[0]; // Update collision status
                    
                            
                            let total_volume = pso_collision_and_volumes[3] + pso_collision_and_volumes_remaining[3];
                            if (pso_collision_and_volumes_remaining[0] === true) { // Found collision in remaining layers
                                //   var_list[7] = 0; // Set to collision
                                pso_use_this_surrogate = 0;
                                // console.log({pso_collision_and_volumes_remaining:pso_collision_and_volumes_remaining});
                                // console.log("Verify: " + pso_collision_and_volumes_remaining[2].toString());
                                
                                overlap_factor = (pso_collision_and_volumes_remaining[2] / (pso_collision_and_volumes_remaining[4]));
                                if (overlap_factor > 1 || isNaN(overlap_factor)) overlap_factor = 1.0;
                                // average_overlap_factor = overlap_factor;
                                // overlap_counter += pso_collision_and_volumes_remaining[5];
                                // overlap_counter += 1;
                                total_volume = ((total_volume / (pso_collision_and_volumes_remaining[6] + quickList.length)) * sliceIndexList.length) * (1-overlap_factor); // Update estimate and scale by collision severity

                            }
                            else {
                                //   var_list[7] = 1; // Set to no collision
                                pso_use_this_surrogate = 1;
                                
                                let finalHeight = pso_z + pso_surrogate.height;

                                if (pso_surrogate.type == "prism") {
                                    const extensionIndexList = getSliceIndexList(this.surrogate_settings.precomputed_slice_heights, pso_z + pso_surrogate.minHeight, pso_z + pso_surrogate.maxHeight);
                                    const extensionData = checkVolumeAndCollisionsExtend(this.surrogate_settings.all_slices, extensionIndexList, pso_polygons_list, finalHeight);
                                    total_volume = total_volume + extensionData[1]; // Add additional saved support volume
                                    // pso_surrogate.height = extensionData[1]; // Update based on found max height // Use end_height instead!
                                    finalHeight = extensionData[0];
                                    // console.log({extensionData:extensionData});
                                    // console.log({finalHeight:finalHeight});
                                    // console.log({surrHeight:pso_z + pso_surrogate.height});
                                } else if (pso_surrogate.type == "stackable") {
                                    const stackIndexList = getStackableIndexList(this.surrogate_settings.precomputed_slice_heights, pso_z + pso_surrogate.minHeight, pso_surrogate.addMaxNumber, pso_surrogate.addHeight);
                                    const stackingData = checkVolumeAndCollisionsStack(this.surrogate_settings.all_slices, stackIndexList, pso_polygons_list, finalHeight, pso_surrogate.addHeight);
                                    total_volume = total_volume + stackingData[1]; // Add additional saved support volume
                                    finalHeight = stackingData[0];
                                    // const id_extension = stackingData[2];
                                }
                                // [collision, volume_estimate, max_collision_area, old_volume - new_volume, max_surrogated_area, collisions_found, checked_layers];

                                // if (good_tower) console.log({Note:"Good tower and no collision"});

                                let lower_surrogate = [];
                                let empty_array = [];
                                let data_array = {insertion_case:"unknown"};
                                // if (tower_library_index >= 0) {
                                //     lower_surrogate.push(all_surrogates[tower_library_index]);
                                //     //   var_list[1] = chosen_x; // We moved the surrogate for the tower successfully
                                //     //   var_list[2] = chosen_y;
                                //     //   var_list[8] = chosen_x; // We moved the surrogate for the tower successfully
                                //     //   var_list[9] = chosen_y;
                                //     tower_details.tower_x = chosen_x; // We moved the surrogate for the tower successfully
                                //     tower_details.tower_y = chosen_y;
                                // }
                                let rotation = chosen_rotation; 
                                let end_height = finalHeight;
                                candidate = {
                                    geometry:pso_polygons_list, 
                                    rotation:rotation,
                                    surro:pso_surrogate, starting_height:pso_z, 
                                    end_height:end_height, 
                                    down_surrogate:lower_surrogate, 
                                    up_surrogate:empty_array, 
                                    outlines_drawn:0, 
                                    insertion_data:data_array
                                };

                                // // check_surrogate_insertion_case(candidate, this.surrogate_settings.start_slice, this.surrogate_settings);
                                // simple_insertion_case_check(candidate, this.surrogate_settings.precomputed_slice_heights);
                                // // console.log({candidate_insertiondata:candidate.insertion_data});

                                // all_surrogates.push(candidate);
                                // new_surrogates.push(candidate);
                            }
                            
                            
                            pso_collision_and_volumes[3] = total_volume; // put updated estimate/full result into result-array

                        }
                        else {
                            // console.log("exploration stopped.");
                            pso_collision_and_volumes[0] = true;// Treat not explored as collision
                        }
                    }
                    results_array = pso_collision_and_volumes;
                }
                else { 
                    pso_collision_and_volumes[0] = true;
                    pso_collision_and_volumes[3] = delta_volume_estimate;

                    results_array = pso_collision_and_volumes;
                }
                let current_details = [...var_list];

                results_meta_data.candidate_details = {pso_details:current_details, pso_idx:pso_idx, candidate_obj:candidate, use_me:pso_use_this_surrogate, tower_details:tower_details};
                // }

                let valid_combination = true;
                // let total_surrogates_volume = this.surrogate_settings.fitness_offset;
                let total_surrogates_volume = 0;
                let total_collided_surrogates_volume = 0;
                let highest_surrogate_volume = 0;

                // for (const result of results_array) {
                if (results_array[0] === true) { // Collided surrogates
                    valid_combination = false;
                    // const delta_volume = result[1] - result[2];
                    total_collided_surrogates_volume = results_array[3];
                    // collision_area_estimate += result[2]; // Get overlap area estimate
                    // surrogate_area_estimate += result[4]; // Biggest sorrgated area
                }
                else { // Good surrogates
                    // good_surrogate_count += 1;
                    // const delta_volume = result[1] - result[2];
                    total_surrogates_volume = results_array[3]; // Get surrogated volume
                    // if (highest_surrogate_volume < results_array[3]) highest_surrogate_volume = results_array[3];
                    highest_surrogate_volume = results_array[3];
                }


                // const average_surrogates_volume = total_surrogates_volume / (good_surrogate_count);
                const average_surrogates_volume = highest_surrogate_volume;
                if (this.surrogate_settings.average_so_far < average_surrogates_volume) this.surrogate_settings.average_so_far = average_surrogates_volume;

                let fitness = total_surrogates_volume*10;

                // if (valid_combination && surrogates_placed_pso > 0) {
                if (valid_combination) {
                    // let current_answer = [...var_list];
                    // this.valid_answers.push(current_answer);
                    // valid_answers.push(current_answer);
                    results_meta_data.valid = true;
                }

                fitness += total_collided_surrogates_volume;
                
                results_meta_data.fitness = fitness;

                if (valid_combination) {
                    this.valid_answers.push(results_meta_data);
                    valid_answers.push(results_meta_data);
                }

                done(fitness);
            }
            
        }, {
            async: true
        });

        let pso_variable_list = [
            // { start: 0, end: surrogate_settings.searchspace_max_number_of_surrogates}// 0: Meta: # of surrogates to be placed
        ];

        // for (let pso_variables_idx = 0; pso_variables_idx < surrogate_settings.searchspace_max_number_of_surrogates; pso_variables_idx += 1) {
        // Could give each block a yes/no variable instead of the meta-#-of-surrogates
        pso_variable_list.push({ start: min_x, end: max_x});    // 0: X position
        pso_variable_list.push({ start: min_y, end: max_y});    // 1: Y position
        pso_variable_list.push({ start: 0, end: 360});          // 2: Rotation in degrees
        // Z height from 0 to model_height for bridge surrogates
        // yes/no switch between index-height and absolute-height method
        // pso_variable_list.push({ start: 0, end: optimizer.surrogate_library.length}); 
                                                                // 5: Which surrogate was placed: library index, mapped from 0 to library_length
        pso_variable_list.push({ start: surrogate_settings.smallest_length, end: surrogate_settings.biggest_length});  // 3: Desired length of ideal surrogate, mapped from smallest to biggest available lengths                                                   
        pso_variable_list.push({ start: surrogate_settings.smallest_width, end: surrogate_settings.biggest_width});  // 4 {10}: Desired length of ideal surrogate, mapped from smallest to biggest available lengths                                                   
        pso_variable_list.push({ start: surrogate_settings.smallest_height, end: surrogate_settings.biggest_height});  // 5 {11}: Desired length of ideal surrogate, mapped from smallest to biggest available lengths                                                   
        // pso_variable_list.push({ start: 0, end: 1});            // 6: Target extension for height-varying surrogates, 0 = min_height, 1 = max_height
        // pso_variable_list.push({ start: 0, end: 0});            // 7: local meta variable: if this surrogate data should be used or not
        // pso_variable_list.push({ start: 0, end: 0});            // 8: local meta variable: Post-tower X position
        // pso_variable_list.push({ start: 0, end: 0});            // 9: local meta variable: Post-tower Y position
            
        // }

        console.log({hull_points:hull_points});

        // set an initial population of 20 particles spread across the search space *[-10, 10] x [-10, 10]*
        optimizer.init(hull_points.length*4 + surrogate_settings.numberOfParticles, pso_variable_list);

        let particle_counter = 0;
        for (let point_idx = 1; point_idx < hull_points.length; point_idx++) {
            let x_dir = hull_points[point_idx-1].x - hull_points[point_idx].x;
            let y_dir = hull_points[point_idx-1].y - hull_points[point_idx].y;

            let hull_rot = Math.atan2(y_dir, x_dir)*180/Math.PI + 180;
            let hull_rot_90 = hull_rot + 90;
            
            optimizer._particles[particle_counter].position[0] = hull_points[point_idx-1].x;
            optimizer._particles[particle_counter].position[1] = hull_points[point_idx-1].y;
            optimizer._particles[particle_counter].position[2] = hull_rot;
            particle_counter++;

            optimizer._particles[particle_counter].position[0] = hull_points[point_idx-1].x;
            optimizer._particles[particle_counter].position[1] = hull_points[point_idx-1].y;
            optimizer._particles[particle_counter].position[2] = hull_rot;
            particle_counter++;

            optimizer._particles[particle_counter].position[0] = hull_points[point_idx].x;
            optimizer._particles[particle_counter].position[1] = hull_points[point_idx].y;
            optimizer._particles[particle_counter].position[2] = hull_rot_90;
            particle_counter++;

            optimizer._particles[particle_counter].position[0] = hull_points[point_idx].x;
            optimizer._particles[particle_counter].position[1] = hull_points[point_idx].y;
            optimizer._particles[particle_counter].position[2] = hull_rot_90;
            particle_counter++;
        }

        // console.log({optimizer_after_init2:optimizer._particles});
        // run the optimizer 40 iterations
        let improvement_Decay = 0;
        let last_Best = 0;
        let consecutive_weak_steps = 0;
        let offset_set = false;
        // for (var i = 0; i < 100; i++) {
        //     optimizer.step();
        //     let stepFitness = optimizer.getBestFitness();
        //     console.log({fitness:stepFitness});
            
            
        //     if (optimizer.surrogate_settings.leniency > 0) {
        //         optimizer.surrogate_settings.leniency = optimizer.surrogate_settings.leniency * 0.2;
        //         // optimizer.surrogate_settings.fitness_offset = stepFitness + stepFitness * optimizer.surrogate_settings.leniency;
        //         if (optimizer.surrogate_settings.leniency < 0.1) optimizer.surrogate_settings.leniency = 0;
        //         // optimizer._bestPositionEver = null;
        //         // optimizer._bestFitnessEver = -Infinity;

        //     } else {
        //         // if (offset_set === false) {
        //         //     optimizer.surrogate_settings.fitness_offset = stepFitness;
        //         //     offset_set = true;
        //         // }
        //         improvement_Decay = (improvement_Decay + stepFitness - last_Best) * 0.05;
        //         console.log({improvement_Decay:improvement_Decay});
        //         if (improvement_Decay < 15) {
        //             consecutive_weak_steps++;
        //         }
        //         else consecutive_weak_steps = 0;

        //         if (consecutive_weak_steps > 10) break;
        //     }
        //     last_Best = stepFitness;
        //     surrogate_settings.best_valid = last_Best;
        // }

        var iterations = 0, maxIterations = 15;
        function loop() {
            if (iterations >= maxIterations) { // TODO: Need handling of further execution if this case is reached
                log('Max iterations reached. Ending search.');
            } else {
                iterations++;
                // log('Iteration ' + iterations + '/' + maxIterations + ' ');
                log('Iteration ' + iterations);

                let stepFitness = optimizer.getBestFitness();
                console.log({fitness:stepFitness});
                // console.log(optimizer.surrogate_settings);
                // const origResult = optimizer.getBestPosition();
                // const cloneResult = [...origResult];
                // console.log({position:origResult});
                
                if (optimizer.surrogate_settings.leniency > 0) {
                    optimizer.surrogate_settings.leniency = optimizer.surrogate_settings.leniency * 0.2;
                    // optimizer.surrogate_settings.fitness_offset = stepFitness + stepFitness * optimizer.surrogate_settings.leniency;
                    if (optimizer.surrogate_settings.leniency < 0.1) optimizer.surrogate_settings.leniency = 0;
                    // optimizer._bestPositionEver = null;
                    // optimizer._bestFitnessEver = -Infinity;

                } else {
                    // if (offset_set === false) {
                    //     optimizer.surrogate_settings.fitness_offset = stepFitness;
                    //     offset_set = true;
                    // }
                    improvement_Decay = improvement_Decay*0.05 + stepFitness - last_Best;
                    console.log({improvement_Decay:improvement_Decay});
                    if (improvement_Decay == 0 || improvement_Decay < last_Best * optimizer.surrogate_settings.minImprovementPercentage) { // Improvement by at least some %
                        consecutive_weak_steps++;
                    }
                    else consecutive_weak_steps = 0;

                    if (consecutive_weak_steps > optimizer.surrogate_settings.search_persistance) return;
                }
                last_Best = stepFitness;
                surrogate_settings.best_valid = last_Best;

                optimizer.step(loop);
            }
        }

        let t_maxIterations = 5;
        let t_iterations = 0;
        function t_loop() {
            if (t_iterations >= t_maxIterations) {
                // log('Max iterations reached. Ending search.');
            }
            else {
                t_iterations++;
                t_optimizer.step(t_loop);
                let stepFitness = t_optimizer.getBestFitness();
                if (stepFitness > 0) console.log({fitness:stepFitness});
            }
        }
    



        //================================ Tower optimization ==========================
        var t_optimizer = new kiri.Optimizer();
        t_optimizer.surrogate_library = surros;
        t_optimizer.surrogate_settings = surrogate_settings;
        t_optimizer.valid_answers = [];
        t_optimizer.setObjectiveFunction(function (var_list, done) { 
            let all_surrogates = [];
            let lower_full = this.surrogate_settings.lower_surr;
            let lower_surr = lower_full.candidate_details.candidate_obj;
            // for (old_surrogate of this.surrogate_settings.existing_surrogates) {
            //     all_surrogates.push(old_surrogate);
            // };
            let results_array = [];

            let overlap_factor = 0;

            let candidate;
            let ts = 1 + lower_full.tower_size;
            let results_meta_data = {valid:false, candidate_details:null, fitness:Number.NEGATIVE_INFINITY, tower_size:ts, below:lower_full, aboves:[]};

            let pso_use_this_surrogate = 0;
            let tower_details = {tower_x:null, tower_y:null};
            let pso_x = var_list[0];
            let pso_y = var_list[1];
            let pso_desired_length = var_list[2];
            let pso_desired_width = var_list[3];
            let pso_desired_height = var_list[4];

            let [ pso_surrogate, pso_idx ] = getBestFittingSurrogateL2(this.surrogate_library, pso_desired_length, pso_desired_width, pso_desired_height);

            // Select test tower position/on baseplate
            let pso_z = lower_surr.end_height;

            let chosen_rotation,
                chosen_x,
                chosen_y;
            let bad_tower = false;
            
            // Stability check V2 // TODO: Allow altering rotations
            let x_space = (lower_surr.surro.length - pso_surrogate.length - 2.4) * 0.5; // TODO: Set to four times nozzle (+ two times padding size?)
            let y_space = (lower_surr.surro.width - pso_surrogate.width - 2.4) * 0.5;
            if (x_space > 0 && y_space > 0) {

                // Handling without rotation :/
                // chosen_rotation = lower_surr.rotation;
                let mid_x = (lower_surr.geometry[0].bounds.maxx + lower_surr.geometry[0].bounds.minx)*0.5;
                let mid_y = (lower_surr.geometry[0].bounds.maxy + lower_surr.geometry[0].bounds.miny)*0.5
                // if (pso_x > mid_x + x_space) chosen_x = mid_x + x_space;
                // else if (pso_x < mid_x - x_space) chosen_x = mid_x - x_space;
                // else chosen_x = pso_x;
                // if (pso_y > mid_y + y_space) chosen_y = mid_y + y_space;
                // else if (pso_y < mid_y - y_space) chosen_y = mid_y - y_space;
                // else chosen_y = pso_y;

                chosen_rotation = lower_surr.rotation;
    
                const degRot = lower_surr.rotation * Math.PI / 180;
                const x_dist = pso_x - mid_x;
                const y_dist = pso_y - mid_y;

                let local_x_dist = Math.cos(degRot)*x_dist + Math.sin(degRot)*y_dist;
                let local_y_dist = -1*Math.sin(degRot)*x_dist + Math.cos(degRot)*y_dist;

                let donothingCounter = 0;

                if (local_x_dist > x_space) local_x_dist = x_space;
                else if (local_x_dist < -x_space) local_x_dist = -x_space;
                else donothingCounter += 1;

                if (local_y_dist > y_space) local_y_dist = y_space;
                else if (local_y_dist < -y_space) local_y_dist = -y_space;
                else donothingCounter += 1;

                if (donothingCounter == 2) {

                    // let global_x_dist = Math.cos(degRot)*local_x_dist - Math.sin(degRot)*local_y_dist;
                    // let global_y_dist = Math.sin(degRot)*local_x_dist + Math.cos(degRot)*local_y_dist;

                    // chosen_x = mid_x + global_x_dist;
                    // chosen_y = mid_y + global_y_dist;

                    // if ((Math.abs(Math.abs(chosen_x) - Math.abs(pso_x)) < 0.001) && (Math.abs(Math.abs(chosen_y) - Math.abs(pso_y)) < 0.001) ) {}
                    // else console.log({WARNING:"ADJUSTMENT"});
                    chosen_x = pso_x;
                    chosen_y = pso_y;
                } else {
                    let global_x_dist = Math.cos(degRot)*local_x_dist - Math.sin(degRot)*local_y_dist;
                    let global_y_dist = Math.sin(degRot)*local_x_dist + Math.cos(degRot)*local_y_dist;

                    chosen_x = mid_x + global_x_dist;
                    chosen_y = mid_y + global_y_dist;
                }

                if (lower_surr.surro.type == "prism") { // In case of prism underneath, check for unsupported area
                    let unsupported_polygons = [];
                    let unsupp_area = 0;

                    let pso_temp_polygons_list;
                    // TODO: Use bottom geometry of prism instead?
                    if (pso_surrogate.type == "simpleRectangle" || pso_surrogate.type == "stackable") {
                        pso_temp_polygons_list = [generateRectanglePolygonCentered(chosen_x, chosen_y, pso_z, pso_surrogate.length, pso_surrogate.width, chosen_rotation, surrogate_settings.surrogate_padding, this.surrogate_settings.start_slice)];
                    }
                    else if (pso_surrogate.type == "prism") {
                        pso_temp_polygons_list = [generatePrismPolygon(chosen_x, chosen_y, pso_z, pso_surrogate.prism_geometry, chosen_rotation, surrogate_settings.surrogate_padding, this.surrogate_settings.start_slice)];
                    }

                    POLY.subtract(pso_temp_polygons_list, lower_surr.geometry, unsupported_polygons, null, this.surrogate_settings.start_slice.z, min);
                    unsupported_polygons.forEach(function(unsupp) {
                        unsupp_area += Math.abs(unsupp.areaDeep());
                    });

                    // For now, use 100% supported area only
                    if (unsupp_area > 0) { 
                        chosen_x = (chosen_x + mid_x) / 2; // Additional centering, then try again
                        chosen_y = (chosen_y + mid_y) / 2;
                        unsupported_polygons = [];
                        unsupp_area = 0;

                        if (pso_surrogate.type == "simpleRectangle" || pso_surrogate.type == "stackable") {
                            pso_temp_polygons_list = [generateRectanglePolygonCentered(chosen_x, chosen_y, pso_z, pso_surrogate.length, pso_surrogate.width, chosen_rotation, surrogate_settings.surrogate_padding, this.surrogate_settings.start_slice)];
                        }
                        else if (pso_surrogate.type == "prism") {
                            pso_temp_polygons_list = [generatePrismPolygon(chosen_x, chosen_y, pso_z, pso_surrogate.prism_geometry, chosen_rotation, surrogate_settings.surrogate_padding, this.surrogate_settings.start_slice)];
                        }

                        POLY.subtract(pso_temp_polygons_list, lower_surr.geometry, unsupported_polygons, null, this.surrogate_settings.start_slice.z, min);
                        unsupported_polygons.forEach(function(unsupp) {
                            unsupp_area += Math.abs(unsupp.areaDeep());
                        });

                        if (unsupp_area > 0) {
                            bad_tower = true;
                        }
                    }
                }

                // console.log({Note:"Valid tower"});
                // console.log({pso_surrogate:pso_surrogate});
                // console.log({bottom_surrogate:lower_surr});
                // let x_move = pso_x % x_space; // Convert to local coordinates
                // let y_move = pso_y % y_space;
                // chosen_x = (lower_surr.geometry[0].bounds.maxx + lower_surr.geometry[0].bounds.minx)*0.5 + x_move; // Add chosen distance to mid point
                // chosen_y = (lower_surr.geometry[0].bounds.maxy + lower_surr.geometry[0].bounds.miny)*0.5 + y_move;
            }
            else { // insufficient room on top of surrogate
                // console.log({Note:"Bad tower"});
                // console.log({pso_surrogate:pso_surrogate});
                // console.log({bottom_surrogate:lower_surr});
                if (x_space < 0) {
                    var_list[2] = var_list[2] * 0.75; // Look for less long surrogate
                }
                if (y_space < 0) {
                    var_list[3] = var_list[3] * 0.75; // Look for less wide surrogate                
                }
                bad_tower = true;
            }

            if (bad_tower) {
                let fitness = 0;
                done(fitness);
            } else {
            
                // generate polygons // TODO: Is it faster to make one poly for the surrogate and then rotate+translate /modify the points directly?
                let pso_polygons_list = [];
                if (pso_surrogate.type == "simpleRectangle" || pso_surrogate.type == "stackable") {
                    pso_polygons_list = [generateRectanglePolygonCentered(chosen_x, chosen_y, pso_z, pso_surrogate.length, pso_surrogate.width, chosen_rotation, surrogate_settings.surrogate_padding, this.surrogate_settings.start_slice)];
                }
                else if (pso_surrogate.type == "prism") {
                    pso_polygons_list = [generatePrismPolygon(chosen_x, chosen_y, pso_z, pso_surrogate.prism_geometry, chosen_rotation, surrogate_settings.surrogate_padding, this.surrogate_settings.start_slice)];
                }

                let oob = false;

                // Out of build-area check
                for (let pso_poly of pso_polygons_list) {
                    // translate widget coordinate system to build plate coordinate system and compare with build plate size (center is at 0|0, bottom left is at -Width/2|-Depth/2)
                    if (pso_poly.bounds.maxx + shift_x > bedWidthArea || pso_poly.bounds.minx + shift_x < -bedWidthArea || pso_poly.bounds.maxy + shift_y > bedDepthArea || pso_poly.bounds.miny + shift_y < -bedDepthArea || pso_z + pso_surrogate.height > device.bedDepth) {
                        // console.log(pso_poly.bounds.maxx);
                        // console.log(pso_poly.bounds.minx);
                        // console.log(pso_poly.bounds.maxy);
                        // console.log(pso_poly.bounds.miny);
                        // console.log("eh");
                        // TODO: save for return later the negative size of overlap for this test part?
                        oob = true;
                    }
                }

                if (oob) {
                    let fitness = 0;
                    done(fitness);
                } else {                 
                    const sliceIndexList = getSliceIndexList(this.surrogate_settings.precomputed_slice_heights, pso_z, pso_z + pso_surrogate.minHeight)
                    let splitLists = reorderSliceIndexList(sliceIndexList, this.surrogate_settings.skimPercentage);
                    let quickList = splitLists[0];
                    let remainderList = splitLists[1];

                    //   var_list[7] = 0;
                    // pso_use_this_surrogate = 0;

                    // let pso_collision_and_volumes = checkVolumeAndCollisions(this.surrogate_library, this.surrogate_settings, this.surrogate_settings.start_slice, library_index, pso_polygons_list, pso_z, all_surrogates);
                    let pso_collision_and_volumes = checkVolumeAndCollisionsListQuick(this.surrogate_settings.all_slices, quickList, sliceIndexList.length, pso_polygons_list, all_surrogates);
                    // console.log({pso_collision_and_volumes:pso_collision_and_volumes});
                    // const delta_volume = pso_collision_and_volumes[1] - pso_collision_and_volumes[2];
                    let delta_volume_estimate = pso_collision_and_volumes[1];
                    if (pso_surrogate.type != "simpleRectangle") delta_volume_estimate = delta_volume_estimate * pso_surrogate.maxHeight / pso_surrogate.minHeight; // Stretch estimate to max height
                    if (delta_volume_estimate > this.surrogate_settings.minVolume) {
                        // console.log({delta_volume_estimate:delta_volume_estimate});
                        
                        // console.log({pso_collision_and_volumes:pso_collision_and_volumes});
                        if (pso_collision_and_volumes[0] === true) { // Collision in quick check found: Use estimate as collided area after reducing by overlap factor.
                            //   var_list[7] = 0;

                            overlap_factor = (pso_collision_and_volumes[2] / (pso_collision_and_volumes[4]));
                            if (overlap_factor > 1 || isNaN(overlap_factor)) overlap_factor = 1.0;
                            pso_collision_and_volumes[3] = delta_volume_estimate * (1-overlap_factor); // Scale estimate by collision severity
                            // if (overlap_factor < smallest_overlap_factor) smallest_overlap_factor = overlap_factor;
                            // average_overlap_factor = overlap_factor;
                            // overlap_counter += pso_collision_and_volumes[5];
                            // overlap_counter += 1;
                        }

                        else { // No collision yet
                            // save successful candidate // TODO: (and validation insertion case and layer)
                            // if (good_tower) console.log({Note:"Good tower and no collision YET"});

                            if (delta_volume_estimate > (this.surrogate_settings.average_so_far * this.surrogate_settings.exploration_factor)) {

                                let pso_collision_and_volumes_remaining = checkVolumeAndCollisionsRemaining(this.surrogate_settings.all_slices, remainderList, pso_polygons_list, all_surrogates);
                                pso_collision_and_volumes[0] = pso_collision_and_volumes_remaining[0]; // Update collision status
                        
                                
                                let total_volume = pso_collision_and_volumes[3] + pso_collision_and_volumes_remaining[3];
                                if (pso_collision_and_volumes_remaining[0] === true) { // Found collision in remaining layers
                                    //   var_list[7] = 0; // Set to collision
                                    pso_use_this_surrogate = 0;
                                    // console.log({pso_collision_and_volumes_remaining:pso_collision_and_volumes_remaining});
                                    // console.log("Verify: " + pso_collision_and_volumes_remaining[2].toString());
                                    
                                    overlap_factor = (pso_collision_and_volumes_remaining[2] / (pso_collision_and_volumes_remaining[4]));
                                    if (overlap_factor > 1 || isNaN(overlap_factor)) overlap_factor = 1.0;
                                    // average_overlap_factor = overlap_factor;
                                    // overlap_counter += pso_collision_and_volumes_remaining[5];
                                    // overlap_counter += 1;
                                    total_volume = ((total_volume / (pso_collision_and_volumes_remaining[6] + quickList.length)) * sliceIndexList.length) * (1-overlap_factor); // Update estimate and scale by collision severity

                                }
                                else {
                                    //   var_list[7] = 1; // Set to no collision
                                    pso_use_this_surrogate = 1;
                                    
                                    let finalHeight = pso_z + pso_surrogate.height;

                                    if (pso_surrogate.type == "prism") {
                                        const extensionIndexList = getSliceIndexList(this.surrogate_settings.precomputed_slice_heights, pso_z + pso_surrogate.minHeight, pso_z + pso_surrogate.maxHeight);
                                        const extensionData = checkVolumeAndCollisionsExtend(this.surrogate_settings.all_slices, extensionIndexList, pso_polygons_list, finalHeight);
                                        total_volume = total_volume + extensionData[1]; // Add additional saved support volume
                                        // pso_surrogate.height = extensionData[1]; // Update based on found max height // Use end_height instead!
                                        finalHeight = extensionData[0];
                                        // console.log({extensionData:extensionData});
                                        // console.log({finalHeight:finalHeight});
                                        // console.log({surrHeight:pso_z + pso_surrogate.height});
                                    } else if (pso_surrogate.type == "stackable") {
                                        const stackIndexList = getStackableIndexList(this.surrogate_settings.precomputed_slice_heights, pso_z + pso_surrogate.minHeight, pso_surrogate.addMaxNumber, pso_surrogate.addHeight);
                                        const stackingData = checkVolumeAndCollisionsStack(this.surrogate_settings.all_slices, stackIndexList, pso_polygons_list, finalHeight, pso_surrogate.addHeight);
                                        total_volume = total_volume + stackingData[1]; // Add additional saved support volume
                                        finalHeight = stackingData[0];
                                        // const id_extension = stackingData[2];
                                    }
                                    // [collision, volume_estimate, max_collision_area, old_volume - new_volume, max_surrogated_area, collisions_found, checked_layers];

                                    // if (good_tower) console.log({Note:"Good tower and no collision"});

                                    let lower_surrogate = [];
                                    let empty_array = [];
                                    let data_array = {insertion_case:"unknown"};
                                    // if (tower_library_index >= 0) {
                                    //     lower_surrogate.push(all_surrogates[tower_library_index]);
                                    //     //   var_list[1] = chosen_x; // We moved the surrogate for the tower successfully
                                    //     //   var_list[2] = chosen_y;
                                    //     //   var_list[8] = chosen_x; // We moved the surrogate for the tower successfully
                                    //     //   var_list[9] = chosen_y;
                                    //     tower_details.tower_x = chosen_x; // We moved the surrogate for the tower successfully
                                    //     tower_details.tower_y = chosen_y;
                                    // }
                                    let end_height = finalHeight;
                                    let rotation = chosen_rotation;
                                    candidate = {
                                        geometry:pso_polygons_list, 
                                        rotation:rotation,
                                        surro:pso_surrogate, starting_height:pso_z, 
                                        end_height:end_height, 
                                        down_surrogate:lower_surrogate, 
                                        up_surrogate:empty_array, 
                                        outlines_drawn:0, 
                                        insertion_data:data_array
                                    };

                                    // // check_surrogate_insertion_case(candidate, this.surrogate_settings.start_slice, this.surrogate_settings);
                                    // simple_insertion_case_check(candidate, this.surrogate_settings.precomputed_slice_heights);
                                    // // console.log({candidate_insertiondata:candidate.insertion_data});

                                    // all_surrogates.push(candidate);
                                    // new_surrogates.push(candidate);
                                }
                                
                                
                                pso_collision_and_volumes[3] = total_volume; // put updated estimate/full result into result-array

                                // Global handling --> replaced by local handling of overlap factors
                                // pso_collision_and_volumes[5] += pso_collision_and_volumes_remaining[5]; // number of collisions
                                // if (pso_collision_and_volumes[5] > 0) {
                                //     const average_collision_area = (pso_collision_and_volumes[2] + pso_collision_and_volumes_remaining[2]) / pso_collision_and_volumes[5]; // average collision area
                                //     pso_collision_and_volumes[2] = average_collision_area;
                                // }
                                // else {console.log({CHECKTHIS_must_be_ZERO:(pso_collision_and_volumes[2] + pso_collision_and_volumes_remaining[2])})};
                                // if (pso_collision_and_volumes[4] < pso_collision_and_volumes_remaining[4]) pso_collision_and_volumes[4] = pso_collision_and_volumes_remaining[4]; // largest surrogate area
                            }
                            else {
                                // console.log("exploration stopped.");
                                pso_collision_and_volumes[0] = true;// Treat not explored as collision
                            }
                        }
                        // if ((Math.random() < 0.2) && (pso_collision_and_volumes[0] == true) && (tower_library_index >= 0)) { // Encourage build plate exploration if bad tower
                        //     //   var_list[3] =   var_list[3] - 0.05; // = 0
                        // } else if ((Math.random() < 0.05) && (pso_collision_and_volumes[0] == true) && (tower_library_index < 0)) { // Encourage tower exploration if bad build plate placement
                        //     //   var_list[3] =   var_list[3] + 0.05; // = Math.random()
                        // }
                        // // else results_array.push(pso_collision_and_volumes);
                        // else results_array = pso_collision_and_volumes;
                        results_array = pso_collision_and_volumes;
                    }
                    else { 
                        pso_collision_and_volumes[0] = true;
                        pso_collision_and_volumes[3] = delta_volume_estimate;

                        results_array = pso_collision_and_volumes;
                    }
                    // }
                    // let current_details = [];
                    // for (let j = 1; j < (1+iteration_number)*this.surrogate_settings.number_of_vars; j++) {
                    let current_details = [...var_list];
                    tower_details.tower_x = chosen_x;
                    tower_details.tower_y = chosen_y;
                    results_meta_data.candidate_details = {pso_details:current_details, pso_idx:pso_idx, candidate_obj:candidate, use_me:pso_use_this_surrogate, tower_details:tower_details};                    // }

                    let valid_combination = true;
                    // let total_surrogates_volume = this.surrogate_settings.fitness_offset;
                    let total_surrogates_volume = 0;
                    let total_collided_surrogates_volume = 0;

                    let highest_surrogate_volume = 0;

                    // for (const result of results_array) {
                    if (results_array[0] === true) { // Collided surrogates
                        valid_combination = false;
                        // const delta_volume = result[1] - result[2];
                        total_collided_surrogates_volume = results_array[3];
                        // collision_area_estimate += result[2]; // Get overlap area estimate
                        // surrogate_area_estimate += result[4]; // Biggest sorrgated area
                    }
                    else { // Good surrogates
                        // good_surrogate_count += 1;
                        // const delta_volume = result[1] - result[2];
                        total_surrogates_volume = results_array[3]; // Get surrogated volume
                        // if (highest_surrogate_volume < results_array[3]) highest_surrogate_volume = results_array[3];
                        highest_surrogate_volume = results_array[3];
                    }
                        // let delta_volume = result[1] - result[2] + this.surrogate_settings.fitness_offset;
                    // }

                    // const average_surrogates_volume = total_surrogates_volume / (good_surrogate_count);
                    const average_surrogates_volume = highest_surrogate_volume;
                    if (this.surrogate_settings.average_so_far < average_surrogates_volume) this.surrogate_settings.average_so_far = average_surrogates_volume;

                    // limit influence of collided volume result
                    // if (total_surrogates_volume > this.surrogate_settings.minVolume && total_collided_surrogates_volume > total_surrogates_volume) total_collided_surrogates_volume = total_surrogates_volume;

                    // const number_of_interactions = interaction_layer_set.size;
                    let fitness = total_surrogates_volume*10;

                    // if (valid_combination && surrogates_placed_pso > 0) {
                    if (valid_combination) {
                        // let current_answer = [...var_list];
                        // this.valid_answers.push(current_answer);
                        // valid_answers.push(current_answer);
                        results_meta_data.valid = true;
                    }

                    fitness += total_collided_surrogates_volume;

                    fitness += (pso_surrogate.width * pso_surrogate.length);

                    results_meta_data.fitness = (lower_full.fitness + fitness - (pso_surrogate.width * pso_surrogate.length));

                    // if (valid_combination && surrogates_placed_pso > 0) {
                    if (valid_combination) {
                        this.valid_answers.push(results_meta_data);
                        valid_answers.push(results_meta_data);
                    }

                    done(fitness);
                }
            }
            
        }, {
            async: true
        });

        let pso_tower_var_list = [];

        pso_tower_var_list.push({ start: min_x, end: max_x});    // 0: X position
        pso_tower_var_list.push({ start: min_y, end: max_y});    // 1: Y position
        pso_tower_var_list.push({ start: surrogate_settings.smallest_length, end: surrogate_settings.biggest_length});  // 2: Desired length of ideal surrogate, mapped from smallest to biggest available lengths                                                   
        pso_tower_var_list.push({ start: surrogate_settings.smallest_width, end: surrogate_settings.biggest_width});  // 3 {10}: Desired length of ideal surrogate, mapped from smallest to biggest available lengths                                                   
        pso_tower_var_list.push({ start: surrogate_settings.smallest_height, end: surrogate_settings.biggest_height});  // 4 {11}: Desired length of ideal surrogate, mapped from smallest to biggest available lengths                                                   




        let return_list = [];

        if (surrogate_number_goal > 0) {
            log('Starting optimizer');
            loop();

            // print the best found fitness value and position in the search space
            console.log(optimizer.getBestFitness(), optimizer.getBestPosition());
            // Optimizer area ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

            // let pso_position_vars = optimizer.getBestPosition();

            // console.log({all_valid_answers_found:optimizer.valid_answers});
            // console.log({all_valid_answers_found_global:valid_answers});

            // let best_result = getBestResult(optimizer.valid_answers);
            // console.log({best_result:best_result});
            
            let simple_list = [];
            let tower_list = [];
            for (let valid_answer of valid_answers) {
                t_optimizer.init(20, pso_tower_var_list);
                
                t_optimizer.surrogate_settings.lower_surr = valid_answer; 
                t_optimizer.valid_answers = [];

                t_iterations = 0;
                t_loop();
                let best_tower = getBestResult(t_optimizer.valid_answers);
                if (t_optimizer.valid_answers.length > 0) console.log({tower_valid_answers:t_optimizer.valid_answers});
                let lower_answer = valid_answer;
                if (best_tower) { // Add the best tower to all lower levels
                    while (lower_answer) {
                        lower_answer.aboves.push(best_tower);
                        lower_answer.tower_fitness = best_tower.fitness;
                        lower_answer = lower_answer.below;
                    }
                    if (valid_answer.tower_size == 1) tower_list.push(valid_answer);
                } else {
                    if (valid_answer.tower_size == 1) simple_list.push(valid_answer); // Avoid adding higher levels of a tower again
                }
            }
            simple_list.sort(function(a, b) { // Best results first
                var keyA = a.fitness,
                    keyB = b.fitness;
                if (keyA < keyB) return 1;
                if (keyA > keyB) return -1;
                return 0;
            });

            tower_list.sort(function(a, b) {
                var keyA = a.tower_fitness,
                    keyB = b.tower_fitness;
                if (keyA < keyB) return 1;
                if (keyA > keyB) return -1;
                return 0;
            });

            let jump_index = 1;
            while(jump_index <= tower_list.length) {
                return_list.push(tower_list[jump_index-1]);
                jump_index = Math.ceil(jump_index * 1.5);
            }

            jump_index = 1;
            while(jump_index <= simple_list.length) {
                return_list.push(simple_list[jump_index-1]);
                jump_index = Math.ceil(jump_index * 1.5);
            }

            console.log({simple_list:simple_list});
            console.log({tower_list:tower_list});
            
            // jump_index = 1;
            // for (let select_index = 0; select_index < valid_answers.length; select_index++) {
            //     if (valid_answers[select_index].aboves.length > 0) {
            //         return_list.push(valid_answers[select_index]);
            //     } else if (select_index >= jump_index) {
            //         return_list.push(valid_answers[select_index]);
            //         jump_index = Math.ceil(jump_index * 1.5);
            //     }
            // }

            console.log({return_list:return_list});

        }   
        

        reply({ seq, output:return_list.length, return_list:return_list });
    },

    bad: (data, seq) => {
        reply({ seq, error: "invalid command" });
    }
};

});
