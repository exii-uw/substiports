/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

"use strict";

// dep: geo.base
// dep: geo.slicer
// dep: geo.polygons
// dep: kiri.utils
// dep: kiri.consts
// dep: kiri-mode.fdm.driver
// dep: kiri-mode.fdm.post
// use: kiri-mode.fdm.fill
// use: ext.clip2
// use: add.three
// use: kiri.kmeans
// use: kiri.hull
// use: kiri.pso
// use: kiri.codec
gapp.register("kiri-mode.fdm.slice", [], (root, exports) => {

const { base, kiri, noop } = root;
const { consts, driver, fill, fill_fixed, newSlice, utils, newKMeans, KMeans, Optimizer, hull, codec, parallelenv} = kiri;
const { config, polygons, util, newPoint } = base;
const { fillArea } = polygons;
const { beltfact } = consts;
const { FDM } = driver;
const { doTopShells, getRangeParameters } = FDM;

const POLY = polygons,
    tracker = util.pwait,
    lopacity = 0.6,
    opacity = 1,
    COLOR = {
        anchor: { check: 0x999933, face: 0x999933, line: 0x999933, opacity, lopacity },
        shell: { check: 0x0077bb, face: 0x0077bb, line: 0x0077bb, opacity, lopacity },
        fill: { check: 0x00bb77, face: 0x00bb77, line: 0x00bb77, opacity, lopacity },
        infill: { check: 0x3322bb, face: 0x3322bb, line: 0x3322bb, opacity, lopacity },
        support: { check: 0xaa5533, face: 0xaa5533, line: 0xaa5533, opacity, lopacity },
        gaps: { check: 0xaa3366, face: 0xaa3366, line: 0xaa3366, opacity, lopacity }
    },
    PROTO = Object.clone(COLOR),
    profile = false,
    profileStart = profile ? console.profile : noop,
    profileEnd = profile ? console.profileEnd : noop,
    debug = false;

let ascii_text_points = [
    [0,16,15,0,0,	//Ascii32
        []],
    [8,10,15,0,0,	//Ascii33
        [5,21,5,7,-1,-1,5,2,4,1,5,0,6,1,5,2]],
    [5,16,15,0,0,	//Ascii34
        [4,21,4,14,-1,-1,12,21,12,14]],
    [11,21,15,0,0,	//Ascii35
        [11,25,4,-7,-1,-1,17,25,10,-7,-1,-1,4,12,18,12,-1,-1,3,6,17,6]],
    [26,20,15,0,0,	//Ascii36
        [8,25,8,-4,-1,-1,12,25,12,-4,-1,-1,17,18,15,20,12,21,8,21,5,20,3,18,3,16,4,14,5,13,7,12,13,10,15,9,16,8,17,6,17,3,15,1,12,0,8,0,5,1,3,3]],
    [31,24,15,0,0,	//Ascii37
        [21,21,3,0,-1,-1,8,21,10,19,10,17,9,15,7,14,5,14,3,16,3,18,4,20,6,21,8,21,10,20,13,19,16,19,19,20,21,21,-1,-1,17,7,15,6,14,4,14,2,16,0,18,0,20,1,21,3,21,5,19,7,17,7]],
    [34,26,15,0,0,	//Ascii38
        [23,12,23,13,22,14,21,14,20,13,19,11,17,6,15,3,13,1,11,0,7,0,5,1,4,2,3,4,3,6,4,8,5,9,12,13,13,14,14,16,14,18,13,20,11,21,9,20,8,18,8,16,9,13,11,10,16,3,18,1,20,0,22,0,23,1,23,2]],
    [7,10,15,0,0,	//Ascii39
        [5,19,4,20,5,21,6,20,6,18,5,16,4,15]],
    [10,14,15,0,0,	//Ascii40
        [11,25,9,23,7,20,5,16,4,11,4,7,5,2,7,-2,9,-5,11,-7]],
    [10,14,15,0,0,	//Ascii41
        [3,25,5,23,7,20,9,16,10,11,10,7,9,2,7,-2,5,-5,3,-7]],
    [8,16,15,0,0,	//Ascii42
        [8,21,8,9,-1,-1,3,18,13,12,-1,-1,13,18,3,12]],
    [5,26,17,0,0,	//Ascii43
        [13,18,13,0,-1,-1,4,9,22,9]],
    [8,10,15,0,0,	//Ascii44
        [6,1,5,0,4,1,5,2,6,1,6,-1,5,-3,4,-4]],
    [2,26,19,0,0,	//Ascii45
        [4,9,22,9]],
    [5,10,15,0,0,	//Ascii46
        [5,2,4,1,5,0,6,1,5,2]],
    [2,22,15,0,0,	//Ascii47
        [20,25,2,-7]],
    [17,20,15,0,0,	//Ascii48
        [9,21,6,20,4,17,3,12,3,9,4,4,6,1,9,0,11,0,14,1,16,4,17,9,17,12,16,17,14,20,11,21,9,21]],
    [4,20,15,0,0,	//Ascii49
        [6,17,8,18,11,21,11,0]],
    [14,20,15,0,0,	//Ascii50
        [4,16,4,17,5,19,6,20,8,21,12,21,14,20,15,19,16,17,16,15,15,13,13,10,3,0,17,0]],
    [15,20,15,0,0,	//Ascii51
        [5,21,16,21,10,13,13,13,15,12,16,11,17,8,17,6,16,3,14,1,11,0,8,0,5,1,4,2,3,4]],
    [6,20,15,0,0,	//Ascii52
        [13,21,3,7,18,7,-1,-1,13,21,13,0]],
    [17,20,15,0,0,	//Ascii53
        [15,21,5,21,4,12,5,13,8,14,11,14,14,13,16,11,17,8,17,6,16,3,14,1,11,0,8,0,5,1,4,2,3,4]],
    [23,20,15,0,0,	//Ascii54
        [16,18,15,20,12,21,10,21,7,20,5,17,4,12,4,7,5,3,7,1,10,0,11,0,14,1,16,3,17,6,17,7,16,10,14,12,11,13,10,13,7,12,5,10,4,7]],
    [5,20,15,0,0,	//Ascii55
        [17,21,7,0,-1,-1,3,21,17,21]],
    [29,20,15,0,0,	//Ascii56
        [8,21,5,20,4,18,4,16,5,14,7,13,11,12,14,11,16,9,17,7,17,4,16,2,15,1,12,0,8,0,5,1,4,2,3,4,3,7,4,9,6,11,9,12,13,13,15,14,16,16,16,18,15,20,12,21,8,21]],
    [23,20,15,0,0,	//Ascii57
        [16,14,15,11,13,9,10,8,9,8,6,9,4,11,3,14,3,15,4,18,6,20,9,21,10,21,13,20,15,18,16,14,16,9,15,4,13,1,10,0,8,0,5,1,4,3]],
    [11,10,15,0,0,	//Ascii58
        [5,14,4,13,5,12,6,13,5,14,-1,-1,5,2,4,1,5,0,6,1,5,2]],
    [14,10,15,0,0,	//Ascii59
        [5,14,4,13,5,12,6,13,5,14,-1,-1,6,1,5,0,4,1,5,2,6,1,6,-1,5,-3,4,-4]],
    [3,24,15,0,0,	//Ascii60
        [20,18,4,9,20,0]],
    [5,26,15,0,0,	//Ascii61
        [4,12,22,12,-1,-1,4,6,22,6]],
    [3,24,15,0,0,	//Ascii62
        [4,18,20,9,4,0]],
    [20,18,15,0,0,	//Ascii63
        [3,16,3,17,4,19,5,20,7,21,11,21,13,20,14,19,15,17,15,15,14,13,13,12,9,10,9,7,-1,-1,9,2,8,1,9,0,10,1,9,2]],
    [55,27,15,0,0,	//Ascii64
        [18,13,17,15,15,16,12,16,10,15,9,14,8,11,8,8,9,6,11,5,14,5,16,6,17,8,-1,-1,12,16,10,14,9,11,9,8,10,6,11,5,-1,-1,18,16,17,8,17,6,19,5,21,5,23,7,24,10,24,12,23,15,22,17,20,19,18,20,15,21,12,21,9,20,7,19,5,17,4,15,3,12,3,9,4,6,5,4,7,2,9,1,12,0,15,0,18,1,20,2,21,3,-1,-1,19,16,18,8,18,6,19,5]],
    [8,18,15,0,0,	//Ascii65
        [9,21,1,0,-1,-1,9,21,17,0,-1,-1,4,7,14,7]],
    [23,21,15,0,0,	//Ascii66
        [4,21,4,0,-1,-1,4,21,13,21,16,20,17,19,18,17,18,15,17,13,16,12,13,11,-1,-1,4,11,13,11,16,10,17,9,18,7,18,4,17,2,16,1,13,0,4,0]],
    [18,21,15,0,0,	//Ascii67
        [18,16,17,18,15,20,13,21,9,21,7,20,5,18,4,16,3,13,3,8,4,5,5,3,7,1,9,0,13,0,15,1,17,3,18,5]],
    [15,21,15,0,0,	//Ascii68
        [4,21,4,0,-1,-1,4,21,11,21,14,20,16,18,17,16,18,13,18,8,17,5,16,3,14,1,11,0,4,0]],
    [11,19,15,0,0,	//Ascii69
        [4,21,4,0,-1,-1,4,21,17,21,-1,-1,4,11,12,11,-1,-1,4,0,17,0]],
    [8,18,15,0,0,	//Ascii70
        [4,21,4,0,-1,-1,4,21,17,21,-1,-1,4,11,12,11]],
    [22,21,15,0,0,	//Ascii71
        [18,16,17,18,15,20,13,21,9,21,7,20,5,18,4,16,3,13,3,8,4,5,5,3,7,1,9,0,13,0,15,1,17,3,18,5,18,8,-1,-1,13,8,18,8]],
    [8,22,15,0,0,	//Ascii72
        [4,21,4,0,-1,-1,18,21,18,0,-1,-1,4,11,18,11]],
    [2,8,15,0,0,	//Ascii73
        [4,21,4,0]],
    [10,16,15,0,0,	//Ascii74
        [12,21,12,5,11,2,10,1,8,0,6,0,4,1,3,2,2,5,2,7]],
    [8,21,15,0,0,	//Ascii75
        [4,21,4,0,-1,-1,18,21,4,7,-1,-1,9,12,18,0]],
    [5,17,15,0,0,	//Ascii76
        [4,21,4,0,-1,-1,4,0,16,0]],
    [11,24,15,0,0,	//Ascii77
        [4,21,4,0,-1,-1,4,21,12,0,-1,-1,20,21,12,0,-1,-1,20,21,20,0]],
    [8,22,15,0,0,	//Ascii78
        [4,21,4,0,-1,-1,4,21,18,0,-1,-1,18,21,18,0]],
    [21,22,15,0,0,	//Ascii79
        [9,21,7,20,5,18,4,16,3,13,3,8,4,5,5,3,7,1,9,0,13,0,15,1,17,3,18,5,19,8,19,13,18,16,17,18,15,20,13,21,9,21]],
    [13,21,15,0,0,	//Ascii80
        [4,21,4,0,-1,-1,4,21,13,21,16,20,17,19,18,17,18,14,17,12,16,11,13,10,4,10]],
    [24,22,15,0,0,	//Ascii81
        [9,21,7,20,5,18,4,16,3,13,3,8,4,5,5,3,7,1,9,0,13,0,15,1,17,3,18,5,19,8,19,13,18,16,17,18,15,20,13,21,9,21,-1,-1,12,4,18,-2]],
    [16,21,15,0,0,	//Ascii82
        [4,21,4,0,-1,-1,4,21,13,21,16,20,17,19,18,17,18,15,17,13,16,12,13,11,4,11,-1,-1,11,11,18,0]],
    [20,20,15,0,0,	//Ascii83
        [17,18,15,20,12,21,8,21,5,20,3,18,3,16,4,14,5,13,7,12,13,10,15,9,16,8,17,6,17,3,15,1,12,0,8,0,5,1,3,3]],
    [5,16,15,0,0,	//Ascii84
        [8,21,8,0,-1,-1,1,21,15,21]],
    [10,22,15,0,0,	//Ascii85
        [4,21,4,6,5,3,7,1,10,0,12,0,15,1,17,3,18,6,18,21]],
    [5,18,15,0,0,	//Ascii86
        [1,21,9,0,-1,-1,17,21,9,0]],
    [11,24,15,0,0,	//Ascii87
        [2,21,7,0,-1,-1,12,21,7,0,-1,-1,12,21,17,0,-1,-1,22,21,17,0]],
    [5,20,15,0,0,	//Ascii88
        [3,21,17,0,-1,-1,17,21,3,0]],
    [6,18,15,0,0,	//Ascii89
        [1,21,9,11,9,0,-1,-1,17,21,9,11]],
    [8,20,15,0,0,	//Ascii90
        [17,21,3,0,-1,-1,3,21,17,21,-1,-1,3,0,17,0]],
    [11,14,15,0,0,	//Ascii91
        [4,25,4,-7,-1,-1,5,25,5,-7,-1,-1,4,25,11,25,-1,-1,4,-7,11,-7]],
    [2,14,15,0,0,	//Ascii92
        [0,21,14,-3]],
    [11,14,15,0,0,	//Ascii93
        [9,25,9,-7,-1,-1,10,25,10,-7,-1,-1,3,25,10,25,-1,-1,3,-7,10,-7]],
    [10,16,15,0,0,	//Ascii94
        [6,15,8,18,10,15,-1,-1,3,12,8,17,13,12,-1,-1,8,17,8,0]],
    [2,16,15,0,0,	//Ascii95
        [0,-2,16,-2]],
    [7,10,15,0,0,	//Ascii96
        [6,21,5,20,4,18,4,16,5,15,6,16,5,17]],
    [17,19,15,0,0,	//Ascii97 --> a
        [15,14,15,0,-1,-1,15,11,13,13,11,14,8,14,6,13,4,11,3,8,3,6,4,3,6,1,8,0,11,0,13,1,15,3]],
    [17,19,16,0,0,	//Ascii98 --> b
        [4,21,4,0,-1,-1,4,11,6,13,8,14,11,14,13,13,15,11,16,8,16,6,15,3,13,1,11,0,8,0,6,1,4,3]],
    [14,18,16,0,1,	//Ascii99 --> c
        [15,11,13,13,11,14,8,14,6,13,4,11,3,8,3,6,4,3,6,1,8,0,11,0,13,1,15,3]],
    [17,19,16,0,0,	//Ascii100
        [15,21,15,0,-1,-1,15,11,13,13,11,14,8,14,6,13,4,11,3,8,3,6,4,3,6,1,8,0,11,0,13,1,15,3]],
    [17,18,15,0,1,	//Ascii101 --> e
        [3,8,15,8,15,10,14,12,13,13,11,14,8,14,6,13,4,11,3,8,3,6,4,3,6,1,8,0,11,0,13,1,15,3]],
    [8,12,11,0,6,	//Ascii102
        [10,21,8,21,6,20,5,17,5,0,-1,-1,2,14,9,14]],
    [22,19,15,0,0,	//Ascii103 --> g
        [15,14,15,-2,14,-5,13,-6,11,-7,8,-7,6,-6,-1,-1,15,11,13,13,11,14,8,14,6,13,4,11,3,8,3,6,4,3,6,1,8,0,11,0,13,1,15,3]],
    [10,19,15,0,0,	//Ascii104 --> h
        [4,21,4,0,-1,-1,4,10,7,13,9,14,12,14,14,13,15,10,15,0]],
    [8,8,6,0,10,	//Ascii105 --> i
        [3,21,4,20,5,21,4,22,3,21,-1,-1,4,14,4,0]],
    [11,10,8,0,9,	//Ascii106 --> j
        [5,21,6,20,7,21,6,22,5,21,-1,-1,6,14,6,-3,5,-6,3,-7,1,-7]],
    [8,17,16,0,2,	//Ascii107 --> k
        [4,21,4,0,-1,-1,14,14,4,4,-1,-1,8,8,15,0]],
    [2,8,8,0,10,	//Ascii108 --> l
        [4,21,4,0]],
    [18,30,27,0,-12,	//Ascii109
        [4,14,4,0,-1,-1,4,10,7,13,9,14,12,14,14,13,15,10,15,0,-1,-1,15,10,18,13,20,14,23,14,25,13,26,10,26,0]],
    [10,19,15,0,-1,	//Ascii110
        [4,14,4,0,-1,-1,4,10,7,13,9,14,12,14,14,13,15,10,15,0]],
    [17,19,17,0,0,	//Ascii111 --> o
        [8,14,6,13,4,11,3,8,3,6,4,3,6,1,8,0,11,0,13,1,15,3,16,6,16,8,15,11,13,13,11,14,8,14]],
    [17,19,15,0,0,	//Ascii112
        [4,14,4,-7,-1,-1,4,11,6,13,8,14,11,14,13,13,15,11,16,8,16,6,15,3,13,1,11,0,8,0,6,1,4,3]],
    [17,19,15,0,0,	//Ascii113
        [15,14,15,-7,-1,-1,15,11,13,13,11,14,8,14,6,13,4,11,3,8,3,6,4,3,6,1,8,0,11,0,13,1,15,3]],
    [8,13,11,0,5,	//Ascii114 --> r
        [4,14,4,0,-1,-1,4,8,5,11,7,13,9,14,12,14]],
    [17,17,13,0,2,	//Ascii115
        [14,11,13,13,10,14,7,14,4,13,3,11,4,9,6,8,11,7,13,6,14,4,14,3,13,1,10,0,7,0,4,1,3,3]],
    [8,12,11,0,7,	//Ascii116
        [5,21,5,4,6,1,8,0,10,0,-1,-1,2,14,9,14]],
    [10,19,17,0,0,	//Ascii117
        [4,14,4,4,5,1,7,0,10,0,12,1,15,4,-1,-1,15,14,15,0]],
    [5,16,15,0,2,	//Ascii118
        [2,14,8,0,-1,-1,14,14,8,0]],
    [11,22,19,0,-4,	//Ascii119
        [3,14,7,0,-1,-1,11,14,7,0,-1,-1,11,14,15,0,-1,-1,19,14,15,0]],
    [5,17,15,0,1,	//Ascii120
        [3,14,14,0,-1,-1,14,14,3,0]],
    [9,16,14,0,3,	//Ascii121
        [2,14,8,0,-1,-1,14,14,8,0,6,-4,4,-6,2,-7,1,-7]],
    [8,17,15,0,2,	//Ascii122 --> z
        [14,14,3,0,-1,-1,3,14,14,14,-1,-1,3,0,14,0]],
    [39,14,15,0,0,	//Ascii123
        [9,25,7,24,6,23,5,21,5,19,6,17,7,16,8,14,8,12,6,10,-1,-1,7,24,6,22,6,20,7,18,8,17,9,15,9,13,8,11,4,9,8,7,9,5,9,3,8,1,7,0,6,-2,6,-4,7,-6,-1,-1,6,8,8,6,8,4,7,2,6,1,5,-1,5,-3,6,-5,7,-6,9,-7]],
    [2,8,15,0,0,	//Ascii124
        [4,25,4,-7]],
    [39,14,15,0,0,	//Ascii125
        [5,25,7,24,8,23,9,21,9,19,8,17,7,16,6,14,6,12,8,10,-1,-1,7,24,8,22,8,20,7,18,6,17,5,15,5,13,6,11,10,9,6,7,5,5,5,3,6,1,7,0,8,-2,8,-4,7,-6,-1,-1,8,8,6,6,6,4,7,2,8,1,9,-1,9,-3,8,-5,7,-6,5,-7]],
    [23,24,15,0,0,	//Ascii126
        [3,6,3,8,4,11,6,12,8,12,10,11,14,8,16,7,18,7,20,8,21,10,-1,-1,3,8,4,10,6,11,8,11,10,10,14,7,16,6,18,6,20,7,21,10,21,12]]
];

let isThin = false, // force line rendering
    isFlat = false, // force flat rendering
    offset = 0;     // poly line generation offsets

function vopt(opt) {
    if (opt) {
        if (isFlat) {
            opt.flat = true;
            opt.outline = true;
            return opt;
        }
        if (isThin) return null;
    }
    return opt;
}

FDM.sliceAll = function(settings, onupdate) {
    // future home of brim and anchor generation
    let widgets = Object.values(kiri.worker.cache)
        .filter(w => !w.meta.disabled)
        .sort((a,b) => {
            return a.slices[0].z - b.slices[0].z
        });
    // ignore first widget
    widgets.shift();
    // count extruders used
    let ext = [];
    for (let w of widgets) {
        if (w.anno && w.anno.extruder >= 0) {
            let e = w.anno.extruder;
            if (ext.indexOf(e) < 0) {
                ext.push(e);
            }
        }
    }
    // remove anchor slices from other widgets (only with multi-material)
    if (ext.length > 1)
    for (let w of widgets) {
        w.slices = w.slices.filter(s => s.index >= 0);
    }
};

/**
 * DRIVER SLICE CONTRACT
 *
 * Given a widget and settings object, call functions necessary to produce
 * slices and then the computations using those slices. This function is
 * designed to run client or server-side and provides all output via
 * callback functions.
 *
 * @param {Object} settings
 * @param {Widget} Widget
 * @param {Function} onupdate (called with % complete and optional message)
 * @param {Function} ondone (called when complete with an array of Slice objects)
 */
FDM.slice = function(settings, widget, onupdate, ondone) {
    let render = settings.render !== false,
        { process, device, controller } = settings,
        isBelt = device.bedBelt,
        isSynth = widget.track.synth,
        isDanger = controller.danger,
        useAssembly = controller.assembly,
        isConcurrent = controller.threaded && kiri.minions.concurrent,
        solidLayers = process.sliceSolidLayers || 0,
        vaseMode = process.sliceFillType === 'vase' && !isSynth,
        metadata = widget.anno,
        extruder = parseInt(isSynth ? process.sliceSupportNozzle : metadata.extruder || 0),
        sliceHeight = process.sliceHeight,
        sliceHeightBase = (isBelt ? sliceHeight : process.firstSliceHeight) || sliceHeight,
        lineWidth = process.sliceLineWidth || device.extruders[extruder].extNozzle,
        fillOffsetMult = 1.0 - bound(process.sliceFillOverlap, 0, 0.8),
        shellOffset = lineWidth,
        fillSpacing = lineWidth,
        fillOffset = lineWidth * fillOffsetMult,
        clipOffset = process.sliceSupportOffset,
        sliceFillAngle = process.sliceFillAngle,
        supportDensity = process.sliceSupportDensity;

    // override globals used by vopt()
    isFlat = controller.lineType === "flat";
    isThin = !isFlat && controller.lineType === "line";
    offset = lineWidth / 2;

    function parseSVGFromText(svg_text, offset) {
        // TODO: Fix ugly SVG import specifically from polyline text
        let points_start = svg_text.search('<polyline points="') + '<polyline points="'.length;
        let points_end = svg_text.search('" style="');
        let points_text = svg_text.substring(points_start, points_end);
        let point_numbers = points_text.split(" ");

        let points_array = [];
        for (let x_point_index = 2; x_point_index < point_numbers.length; x_point_index = x_point_index + 2) {
            if (offset) {
                let offset_x = (parseFloat(point_numbers[x_point_index]) / 2.54) + offset.x;
                let offset_y = (parseFloat(point_numbers[x_point_index+1]) / 2.54) + offset.y;
                let one_svg_point = newPoint(offset_x, offset_y, 0.0);
                points_array.push(one_svg_point);
            }
            else {
                points_array.push(newPoint(parseFloat(point_numbers[x_point_index])/2.54,  parseFloat(point_numbers[x_point_index+1])/2.54, 0.0));
            }
        }


        return points_array;
    }

    let loadedData2 = fetch('/obj/Surrogate_Option_Plate9.svg')
        .then(response => response.text())
        .then(data => {
            return data;
    });

    let loadedData3 = fetch('/obj/Surrogate_Option_Plate_Bottom.svg')
        .then(response => response.text())
        .then(data => {
            return data;
        });

    let prisms_obj = [];
    Promise.all([loadedData3, loadedData2]).then((val) => {
        // let prisms_obj = [{geometry_points:parseSVGFromText(val[0], {x:0, y:10}), name:"bottom_shape", extension_range:0}];
        
        // for (let iter = 1; iter < val.length; iter += 1) {
        //     prisms_obj.push({geometry_points:parseSVGFromText(val[iter]), name:"options_plate"+iter.toString(), extension_range:17})
        // }
        prisms_obj.push({geometry_points:parseSVGFromText(val[0]), name:"bottom_shape", extension_range:0});
        prisms_obj.push({geometry_points:parseSVGFromText(val[1]), name:"silver_jack", ini_height:28.75, extension_range:17});
        prisms_obj.push({geometry_points:parseSVGFromText(val[1]), name:"blue_jack", ini_height:48.9, extension_range:35});
    })

    if (isFlat) {
        Object.values(COLOR).forEach(color => {
            color.flat = true;
            color.line = 1
            color.opacity = 1;
        });
    } else {
        Object.keys(COLOR).forEach(key => {
            const color = COLOR[key];
            const proto = PROTO[key]
            color.flat = proto.flat;
            color.line = proto.line;
            color.opacity = proto.opacity;
        });
    }

    if (!(sliceHeight > 0 && sliceHeight < 100)) {
        return ondone("invalid slice height");
    }
    if (!(lineWidth >= 0.01 && lineWidth < 100)) {
        return ondone("invalid nozzle size");
    }

    const sliceMinHeight = process.sliceAdaptive && process.sliceMinHeight > 0 ?
        Math.min(process.sliceMinHeight, sliceHeight) : 0;

    if (sliceHeightBase <= 0) {
        console.log("invalid first layer height < slice height");
        console.log("reverting to min valid slice height");
        sliceHeightBase = sliceMinHeight || sliceHeight;
    }

    let bounds = widget.getBoundingBox();
    let points = widget.getPoints();
    let indices = [];
    let heights = [];

    // handle z cutting (floor method) and base flattening
    let zPress = isBelt ? process.firstLayerFlatten || 0 : 0;
    let zCut = widget.track.zcut || 0;
    if (zCut || zPress) {
        for (let p of points) {
            if (!p._z) {
                p._z = p.z;
                if (zPress) {
                    if (isBelt) {
                        let zb = (p.z - p.y) * beltfact;
                        if (zb > 0 && zb <= zPress) {
                            p.y += zb * beltfact;
                            p.z -= zb * beltfact;
                        }
                    } else {
                        if (p.z <= zPress) p.z = 0;
                    }
                }
                if (zCut && !isBelt) {
                    p.z -= zCut;
                }
            }
        }
    }

    base.slice(points, {
        debug: process.xray,
        xray: process.xray,
        zMin: bounds.min.z,
        zMax: bounds.max.z - zCut,
        // support/synth usually has overlapping boxes
        union: controller.healMesh || isSynth,
        indices: process.indices || process.xray,
        useAssembly,
        post: 'FDM',
        post_args: {
            shellOffset,
            fillOffset,
            clipOffset,
            lineWidth,
            vaseMode,
            isSynth,
            process,
            isDanger,
        },
        // z index generator
        zGen(zopt) {
            if (process.xray) {
                return zopt.zIndexes;
            }
            let { zMin, zMax } = zopt;
            let h1 = sliceHeight;
            let h0 = sliceHeightBase || h1;
            let hm = sliceMinHeight || 0;
            let h = h0;
            let z = h0;
            let zi = indices; // indices
            let zh = heights; // heights
            if (hm) {
                // adaptive increments based on z indices (var map to legacy code)
                let zIncFirst = h0;
                let zInc = h1;
                let zIncMin = hm;
                let zHeights = heights;
                let zIndexes = indices;
                let zOrdered = Object.values(zopt.zIndexes).map(v => parseFloat(v));
                // console.log('adaptive slicing', zIncMin, ':', zInc, 'from', zMin, 'to', zMax);
                let zPos = zIncFirst,
                    zOI = 0,
                    zDelta,
                    zDivMin,
                    zDivMax,
                    zStep,
                    nextZ,
                    lzp = zPos;
                // adaptive slice height
                // first slice/height is fixed from base
                zHeights.push(zIncFirst);
                zIndexes.push(zIncFirst);
                // console.log({zIncFirst, zOrdered})
                while (zPos < zMax && zOI < zOrdered.length) {
                    nextZ = zOrdered[zOI++];
                    if (zPos >= nextZ) {
                        // console.log('skip',{zPos},'>=',{nextZ});
                        continue;
                    }
                    zDelta = nextZ - zPos;
                    if (zDelta < zIncMin) {
                        // console.log('skip',{zDelta},'<',{zIncMin});
                        continue;
                    }
                    zDivMin = Math.floor(zDelta / zIncMin);
                    zDivMax = Math.floor(zDelta / zInc);
                    if (zDivMax && zDivMax <= zDivMin) {
                        if (zDelta % zInc > 0.01) zDivMax++;
                        zStep = zDelta / zDivMax;
                        // console.log(`--- zDivMax <= zDivMin ---`, zStep, zDelta % zInc)
                    } else {
                        zStep = zDelta;
                    }
                    // console.log({nextZ, zPos, zDelta, zStep, zDivMin, zDivMax})
                    while (zPos < nextZ) {
                        zHeights.push(zStep);
                        zIndexes.push(zPos + zStep);
                        zPos += zStep;
                        // console.log({D: zPos - lzp, zPos})
                        // lzp = zPos;
                    }
                }
                // console.log({zIndexes, zHeights});
            } else {
                // simple based + fixed increment
                while (z <= zMax) {
                    zh.push(h);
                    zi.push(z);
                    h = h1;
                    z += h;
                }
            }
            // reduce slice position by half height
            for (let i=0; i<zi.length; i++) {
                zi[i] = (zi[i] - zh[i] / 2).round(3);
            }
            return zi;
        },
        // slicer function (worker local or minion distributed)
        slicer(z, points, opts) {
            // opts.debug = opts.debug || isSynth;
            return (isConcurrent ? kiri.minions.sliceZ : base.sliceZ)(z, points, opts);
        },
        onupdate(update) {
            return onupdate(0.0 + update * 0.5)
        }
    }).then((output) => {
        // post process slices and re-incorporate missing meta-data
        return output.slices.map(data => {
            let { z, clip, lines, groups } = data;
            if (!data.tops) return null;
            let slice = newSlice(z).addTops(data.tops);
            slice.index = indices.indexOf(z);
            slice.height = heights[slice.index];
            slice.clips = clip;
            if (process.xray) {
                slice.lines = lines;
                slice.groups = groups;
                slice.xray = process.xray;
            }
            return slice;
        }).filter(s => s);
    }).then(slices => {
        return onSliceDone(slices);
    }).then(ondone);

    async function doShadow(slices) {
        if (widget.shadow) {
            return;
        }
        let root = widget.group[0];
        if (root.shadow) {
            widget.shadow = root.shadow;
            return;
        }
        // create shadow for clipping supports
        let alltops = widget.group
            .filter(w => !w.track.synth) // no supports in shadow
            .map(w => w.slices).flat()
            .map(s => s.tops).flat().map(t => t.simple);
        let shadow = isConcurrent ?
            await kiri.minions.union(alltops, 0.1) :
            POLY.union(alltops, 0.1, true);
        // expand shadow when requested (support clipping)
        if (process.sliceSupportExtra) {
            shadow = POLY.offset(shadow, process.sliceSupportExtra);
        }
        widget.shadow = root.shadow = POLY.setZ(shadow, 0);
        // slices[0].output()
        //     .setLayer('shadow', { line: 0xff0000, check: 0xff0000 })
        //     .addPolys(shadow);
    }

    async function onSliceDone(slices) {
        // remove all empty slices above part but leave below
        // for multi-part (multi-extruder) setups where the void is ok
        // also reverse because slicing occurs bottom-up
        let found = false;
        slices = slices.reverse().filter(slice => {
            if (slice.tops.length) {
                return found = true;
            } else {
                return found;
            }
        }).reverse();

        // connect slices into linked list for island/bridge projections
        for (let i=1; i<slices.length; i++) {
            slices[i-1].up = slices[i];
            slices[i].down = slices[i-1];
        }

        widget.slices = slices;

        if (!slices || slices.length === 0) {
            return;
        }

        // attach range params to each slice
        for (let slice of slices) {
            slice.params = getRangeParameters(process, slice.index);
        }

        // create shadow for non-belt supports
        if (!isBelt && (isSynth || (!isSynth && supportDensity && process.sliceSupportEnable))) {
            await doShadow(slices);
        }

        // for synth support widgets, clip/offset to other widgets in group
        if (isSynth) {
            for (let slice of slices) {
                let gap = sliceHeight * (isBelt ? 0 : process.sliceSupportGap);
                // clip tops to other widgets in group
                let tops = slice.topPolys();
                for (let peer of widget.group) {
                    // skip self
                    if (peer === widget || !peer.slices) {
                        continue;
                    }
                    for (let pslice of peer.slices) {
                        if (Math.abs(Math.abs(pslice.z - slice.z) - gap) > 0.1) {
                            continue;
                        }
                        let ntops = [];
                        POLY.subtract(tops, pslice.clips, ntops, null, slice.z, 0);
                        tops = ntops;
                    }
                    // trim to group's shadow if not in belt mode
                    if (!isBelt) {
                        tops = POLY.setZ(POLY.trimTo(tops, widget.shadow), slice.z);
                    }
                }
                slice.tops = [];
                for (let t of tops) {
                    slice.addTop(t);
                }
                doShells(slice, 1, shellOffset / 2);
            }
        }

        // calculate % complete and call onupdate()
        function doupdate(index, from, to, msg) {
            trackupdate(index / slices.length, from, to, msg);
        }

        function trackupdate(pct, from, to, msg) {
            onupdate(0.5 + (from + (pct * (to - from))) * 0.5, msg);
        }

        // for each slice, performe a function and call doupdate()
        function forSlices(from, to, fn, msg) {
            slices.forEach(slice => {
                fn(slice);
                doupdate(slice.index, from, to, msg)
            });
        }

        // do not hint polygon fill longer than a max span length
        config.hint_len_max = util.sqr(process.sliceBridgeMax);

        // reset for solids, support projections
        // and other annotations
        slices.forEach(slice => {
            slice.widget = widget;
            slice.extruder = extruder;
            slice.solids = [];
        });

        // just the top/bottom special solid layers or range defined solid layers
        forSlices(0.15, 0.2, slice => {
            let range = slice.params;
            let spaceMult = slice.index === 0 ? process.firstLayerLineMult || 1 : 1;
            let isBottom = slice.index < process.sliceBottomLayers;
            let isTop = slice.index > slices.length - process.sliceTopLayers - 1;
            let isDense = range.sliceFillSparse > 0.995;
            let isSolid = (isBottom || ((isTop || isDense) && !vaseMode)) && !isSynth;
            let solidWidth = isSolid ? range.sliceFillWidth || 1 : 0;
            if (solidWidth) {
                let fillSpace = fillSpacing * spaceMult * solidWidth;
                doSolidLayerFill(slice, fillSpace, sliceFillAngle);
            }
            sliceFillAngle += 90.0;
        }, "solid layers");

        // add lead in anchor when specified in belt mode (but not for synths)
        if (isBelt && !isSynth) {
            // find adjusted zero point from slices
            let smin = Infinity;
            for (let slice of slices) {
                let miny = Infinity;
                for (let poly of slice.topPolys()) {
                    let y = poly.bounds.maxy;
                    let z = slice.z;
                    let by = z - y;
                    if (by < miny) miny = by;
                    if (by < smin) smin = by;
                }
                slice.belt = { miny, touch: false };
            }
            // mark slices with tops touching belt
            // also find max width of first 5 layers
            let start;
            let minx = Infinity, maxx = -Infinity;
            let peek = 0;
            for (let slice of slices) {
                if (slice.tops.length && peek++ < 5) {
                    for (let poly of slice.topPolys()) {
                        minx = Math.min(minx, poly.bounds.minx);
                        maxx = Math.max(maxx, poly.bounds.maxx);
                    }
                }
                // mark slice as touching belt if near miny
                // if (Math.abs(slice.belt.miny - smin) < 0.01) {
                if (Math.abs(slice.belt.miny) < 0.01) {
                    slice.belt.touch = true;
                    if (!start) start = slice;
                }
            }
            // ensure we start against a layer with shells
            while (start && start.up && start.topShells().length === 0) {
                start = start.up;
            }
            // if a brim applies, add that width to anchor
            let brim = getRangeParameters(process, 0).firstLayerBrim || 0;
            if (brim) {
                minx -= brim;
                maxx += brim;
            }
            // array of added top.fill_sparse arrays
            let adds = [];
            let anchorlen = (process.beltAnchor || process.firstLayerBeltLead) * beltfact;
            while (anchorlen && start && anchorlen >= sliceHeight) {
                let addto = start.down;
                if (!addto) {
                    addto = newSlice(start.z - sliceHeight);
                    addto.extruder = extruder;
                    addto.belt = { };
                    addto.height = start.height;
                    addto.up = start;
                    start.down = addto;
                    slices.splice(0,0,addto);
                } else if (!addto.belt) {
                    console.log({addto_missing_belt: addto});
                    addto.belt = {};
                }
                addto.index = -1;
                addto.belt.anchor = true;
                // this allows the anchor to print bi-directionally
                // by removing the forced start-point in print.js
                addto.belt.touch = false;
                let z = addto.z;
                let y = z - smin - (lineWidth / 2);
                let splat = base.newPolygon().add(minx, y, z).add(maxx, y, z).setOpen();
                let snew = addto.addTop(splat).fill_sparse = [ splat ];
                adds.push(snew);
                start = addto;
                anchorlen -= sliceHeight;
            }
            // add anchor bump
            let bump = process.firstLayerBeltBump;
            if (bump) {
                adds = adds.reverse().slice(1, adds.length - 1);
                let count = 1;
                for (let add of adds) {
                    let poly = add[0];
                    let y = count++ * -start.height * 2;
                    if (-y > bump) {
                        count--;
                        // break;
                    }
                    let first = poly.first();
                    // add up/over/down to anchor line (close = down)
                    // which completes the bump perimeter
                    poly.push(poly.last().add({x:0, y, z:0}));
                    poly.push(poly.first().add({x:0, y, z:0}));
                    poly.setClosed();
                    if (count > 2 && maxx - minx > 10) {
                        // add vertical hatch lines insibe bump shell
                        let mp = (maxx + minx) / 2;
                        let dx = (maxx - minx - 2);
                        dx = (Math.floor(dx / 3) * 3) / 2;
                        let fy = first.y;
                        let fz = first.z;
                        let n2 = lineWidth / 2;
                        for (let x = mp - dx; x <= mp + dx ; x += 3) {
                            add.push( base.newPolygon().add(x, fy - n2, fz).add(x, fy + y + n2, fz).setOpen() );
                        }
                    }
                }
            }
        }

        // calculations only relevant when solid layers are used
        if (solidLayers && !vaseMode && !isSynth) {
            profileStart("delta");
            forSlices(0.2, 0.34, slice => {
                let params = slice.params || process;
                let solidMinArea = params.sliceSolidMinArea;
                let sliceFillGrow = params.sliceFillGrow;
                doDiff(slice, { min: solidMinArea, grow: sliceFillGrow });
            }, "layer deltas");
            profileEnd();
            profileStart("delta-project");
            forSlices(0.34, 0.35, slice => {
                projectFlats(slice, solidLayers);
                projectBridges(slice, solidLayers);
            }, "layer deltas");
            profileEnd();
            profileStart("solid-fill")
            let promises = isConcurrent ? [] : undefined;
            forSlices(0.35, promises ? 0.4 : 0.5, slice => {
                let params = slice.params || process;
                let first = slice.index === 0;
                let solidWidth = params.sliceFillWidth || 1;
                let spaceMult = first ? params.firstLayerLineMult || 1 : 1;
                let fillSpace = fillSpacing * spaceMult * solidWidth;
                let solidMinArea = params.sliceSolidMinArea;
                doSolidsFill(slice, fillSpace, sliceFillAngle, solidMinArea, promises);
                sliceFillAngle += 90.0;
            }, "fill solids");
            // very last layer (top) is set to finish solid rate
            slices.last().finishSolids = true
            if (promises) {
                await tracker(promises, (i, t) => {
                    trackupdate(i / t, 0.4, 0.5);
                });
            }
            profileEnd();
        }

        if (!isSynth && !vaseMode) {
            // sparse layers only present when non-vase mose and sparse % > 0
            let lastType;
            let promises = isConcurrent ? [] : undefined;
            forSlices(0.5, promises ? 0.55 : 0.7, slice => {
                let params = slice.params || process;
                if (!params.sliceFillSparse) {
                    return;
                }
                let newType = params.sliceFillType;
                doSparseLayerFill(slice, {
                    settings,
                    process,
                    device,
                    lineWidth,
                    spacing: fillOffset,
                    density: params.sliceFillSparse,
                    bounds: widget.getBoundingBox(),
                    height: sliceHeight,
                    type: newType,
                    cache: params._range !== true && lastType === newType,
                    promises
                });
                lastType = newType;
            }, "infill");
            if (promises) {
                await tracker(promises, (i, t) => {
                    trackupdate(i / t, 0.55, 0.7);
                });
            }
            // back-fill slices marked for infill cloning
            for (let slice of slices) {
                if (slice._clone_sparse) {
                    let tops = slice.tops;
                    let down = slice.down.tops;
                    for (let i=0; i<tops.length; i++) {
                        tops[i].fill_sparse = down[i].fill_sparse.map(p => p.cloneZ(slice.z));
                    }
                }
            }
        } else if (isSynth) {
            // fill manual supports differently
            let outline = process.sliceSupportOutline || false;
            let promises = isConcurrent ? [] : undefined;
            let resolve = [];
            forSlices(0.5, promises ? 0.6 : 0.7, slice => {
                let params = slice.params || process;
                let density = params.sliceSupportDensity;
                if (density)
                for (let top of slice.tops) {
                    if (!outline) {
                        let offset = top.shells;
                        fillSupportPolys(promises, offset, lineWidth, density, slice.z, isBelt);
                        resolve.push({top, offset});
                    } else {
                        let offset = [];
                        POLY.expand(top.shells || [], -lineWidth/4, slice.z, offset);
                        fillSupportPolys(promises, offset, lineWidth, density, slice.z, isBelt);
                        resolve.push({top, offset});
                    }
                }
            }, "infill");
            if (promises) {
                await tracker(promises, (i, t) => {
                    trackupdate(i / t, 0.6, 0.7);
                });
            }
            for (let rec of resolve) {
                let lines = rec.top.fill_lines = rec.offset.map(o => o.fill).flat().filter(v => v);
                // if copying simply's support type, eliminate shells
                // and zig/zag lines connectd by shell segments
                if (!outline) {
                    let newlines = [];
                    let op2;
                    let eo = 0;
                    let idx = 1;
                    for (let i=0; i<lines.length; i += 2) {
                        let p1 = lines[i];
                        let p2 = lines[i+1];
                        p1.index = idx;
                        p2.index = idx++;
                        if (eo++ % 2 === 1) {
                            let t = p1;
                            p1 = p2;
                            p2 = t;
                        }
                        if (op2) {
                            let op1 = p1.clone();
                            op1.index = op2.index;
                            newlines.push(op2);
                            newlines.push(op1);
                        }
                        newlines.push(p1);
                        newlines.push(p2);
                        op2 = p2.clone();
                        op2.index = idx++;
                    }
                    rec.top.fill_lines = newlines;
                    rec.top.shells = [];
                }
            }
        }

        // auto support generation
        if (!isBelt && !isSynth && supportDensity && process.sliceSupportEnable) {
            doShadow(slices);
            profileStart("support");
            let promises = [];
            forSlices(0.7, 0.75, slice => {
                promises.push(doSupport(slice, process, widget.shadow, { exp: isDanger }));
            }, "support");
            console.log({promises_Support:promises});
            await tracker(promises, (i, t) => {
                trackupdate(i / t, 0.75, 0.8);
            });
            profileEnd();


            profileStart("surrogates"); // TODO check if this inserted profile works with data logging
            let highest_slice = slices[slices.length-1];
            let bottom_slice = slices[0];
            // doupdate(0, 0.71, 0.8, "surrogating2");
            console.log({status:"doing surrogates"});
            console.log({loadedDatanow:loadedData2});
            // // let prisms_obj = [{geometry_points:parseSVGFromText(val[0], {x:0, y:10}), name:"bottom_shape", extension_range:0}];
            // let prisms_obj = [{geometry_points:parseSVGFromText(val[0]), name:"bottom_shape", extension_range:0}];
            // // for (let iter = 1; iter < val.length; iter += 1) {
            // //     prisms_obj.push({geometry_points:parseSVGFromText(val[iter]), name:"options_plate"+iter.toString(), extension_range:17})
            // // }
            // prisms_obj.push({geometry_points:parseSVGFromText(val[1]), name:"silver_jack", ini_height:28.75, extension_range:17})
            // prisms_obj.push({geometry_points:parseSVGFromText(val[1]), name:"blue_jack", ini_height:48.9, extension_range:35})
            let view = null; // TODO

            let [ support_pointsDB, support_points_simpleDB ] = getSupportPointsDebug(bottom_slice, process, settings);

            let [ support_points, support_points_simple ] = getSupportPoints(bottom_slice, process, settings);

            console.log({support_points_simple:support_points_simple});
            console.log({support_points:support_points});




            function k_combinations(set, k) {
                var i, j, combs, head, tailcombs;
                
                // There is no way to take e.g. sets of 5 elements from
                // a set of 4.
                if (k > set.length || k <= 0) {
                    return [];
                }
                
                // K-sized set has only one K-sized subset.
                if (k == set.length) {
                    return [set];
                }
                
                // There is N 1-sized subsets in a N-sized set.
                if (k == 1) {
                    combs = [];
                    for (i = 0; i < set.length; i++) {
                        combs.push([set[i]]);
                    }
                    return combs;
                }
                
                combs = [];
                for (i = 0; i < set.length - k + 1; i++) {
                    // head is a list that includes only our current element.
                    head = set.slice(i, i + 1);
                    // We take smaller combinations from the subsequent elements
                    tailcombs = k_combinations(set.slice(i + 1), k - 1);
                    // For each (k-1)-combination we join it with the current
                    // and store it to the set of k-combinations.
                    for (j = 0; j < tailcombs.length; j++) {
                        combs.push(head.concat(tailcombs[j]));
                    }
                }
    
                return combs;
            }
    
            function only_m_combinations(set, m) {
                var k, i, combs, k_combs;
                combs = [];
                
                // Calculate all non-empty k-combinations
                for (k = 0; k <= m; k++) {
                    k_combs = k_combinations(set, k);
                    for (i = 0; i < k_combs.length; i++) {
                        combs.push(k_combs[i]);
                    }
                }
                return combs;
            }
    

            let debugList = Array.from(Array(80), () => []);
            let debugArray = [ ...Array(debugList.length).keys() ];
    
            console.log({debugArray:debugArray});
    
            var candidate_combinations = only_m_combinations(debugArray, 3); // 500_2, 100_3, 45_4, 30_5...... 21_8 for best single/tower solution from all threads
            console.log({candidate_combinations:candidate_combinations});


            let susu_data_objs = [];

            // Get concave hulls of support clusters
            let cluster_promises = [];

            let k_means_depth = 6;

            for (let kn = 0; kn < k_means_depth; kn++) {
                const kint = Math.floor(kn+1); // Not sure if required to ensure kn doesn't change during minion runtime
                cluster_promises.push(kiri.minions.clusterSupports(support_points_simple, kint, bottom_slice.z));
                susu_data_objs.push({kn:kn, candidate_list:[], graph_edges_sets:[], verify_list:[], prune_list:[], selection_list:[]});
            }
            
            let cluster_list = [];
            if (cluster_promises) {
                for (let p of cluster_promises) {
                    p.then(data => {
                        // tracker(count++, promises.length, data);
                        cluster_list.push(data);
                    });
                }
                await Promise.all(cluster_promises);
            }

            let surrogate_library = getSurrogateLibrary(prisms_obj);

            let [ prepared_slices, surrogate_settings ] = prepareSurrogating(surrogate_library, highest_slice, process, settings);
            // let surrogate_settings = {};

            let sliceStackData = getEncodedData(bottom_slice);
            console.log({sliceStackData:sliceStackData});
            console.log({bottomMock:sliceStackData[0]});
            console.log({bottom_slice:bottom_slice});

            widget.slices = prepared_slices;
            
            let test_promises = [];

            let test_array = [5, 8, 10, 3, 7, 29, 1, 15, 88, 6];
            let test_out = [];
            
    
            let test_poly_list = bottom_slice.topPolys();
            console.log({bottom_slice:bottom_slice});
            console.log({test_poly_list:test_poly_list});
            
            // let point1 = newPoint(0,0,0);
            // let point2 = newPoint(0,1,0);
            // let point3 = newPoint(1,1,0);
            // let point4 = newPoint(1,0,0);
            // let rect_points = [point1, point2, point3, point4];
            // let rectanglePolygon = base.newPolygon(rect_points);
            // let rectanglePolygon2 = base.newPolygon(rect_points);
            // let rectanglePolygon3 = base.newPolygon(rect_points);
            // let rectanglePolygon4 = base.newPolygon(rect_points);
            // let encodedPolys = kiri.codec.encode([rectanglePolygon, rectanglePolygon2, rectanglePolygon3, rectanglePolygon4], {full: true});

            let encodedTops = kiri.codec.encode(test_poly_list, {full: true});

            let decodedTop = kiri.codec.decode(encodedTops, {full: true});
            // console.log({encodedPolys:encodedPolys});

            let test_test_array = [encodedTops,[2,3,4,[11,12]],[5,6,7]];

            // let test_poly_list2 = bottom_slice.topPolys();
            // let encodedPolys2 = kiri.codec.encode(test_poly_list2, {full: true});
            // encodedPolys2[0] = encodedPolys2[1];
            // let decodedPolys2 = kiri.codec.decode(encodedPolys2, {full: true});
            // console.log({decodedPolys2:decodedPolys2})
            // let decodedPolys3 = kiri.codec.decode(encodedPolys2, {full: true});
            // console.log({decodedPolys3:decodedPolys3})


            let encoded_kiri_tops = []
            for (let oneTop of test_poly_list) {
                encoded_kiri_tops.push(kiri.codec.encode(oneTop, {full: true}));
            }

            // for (let integr of test_array) {
            //     test_promises.push(kiri.minions.test(encodedPolys, integr, highest_slice, test_poly_list, encodedTops, test_test_array));
            // }

            let optimizer_promises = [];
            surrogate_settings.start_slice = null;
            surrogate_settings.all_slices = null;
            // optimizer_promises.push(kiri.minions.surrogateClusterSearch(sliceStackData, surrogate_library, cluster_list[0].concave_cluster_hulls[0], surrogate_settings, settings.device, bottom_slice.widget, cluster_list[0].kn));

            for (let cluster of cluster_list) {
                console.log({cluster:cluster});
                for (let cluster_hull of cluster.concave_cluster_hulls) {
                    optimizer_promises.push(kiri.minions.surrogateClusterSearch(sliceStackData, surrogate_library, cluster_hull, surrogate_settings, settings.device, bottom_slice.widget, cluster.kn-1)); // kn-1 because we plus1 them when building clusters, but susu_data_objs counting starts at 0
                }
            }

    
            // if (test_promises) {
            //     await Promise.all(test_promises);
            //     .then(() => {
            //         api.log.emit('analysis complete').unpin();
            //     });
            //     // await tracker(test_promises, (i, t) => {
            //     //     trackupdate(i / t, 0.1, 0.9);
            //     // });
            //     for (let tp of test_promises) {
            //         console.log(tp);
            //         let numberBig = false;
            //         // if (tp.PromiseResult[0] > 200) numberBig = true;
            //         if (tp[0][0] > 200) numberBig = true;
            //         console.log({numberBig:numberBig});
            //     }
            // }

            
            if (test_promises) {
                for (let p of test_promises) {
                    p.then(data => {
                        console.log({test_data:data});
                        // graph_edges_sets.push(...data.graph_edges_lists);
                        // susu_data_objs[data.kn].graph_edges_sets.push(...data.graph_edges_sets);
                        // susu_data_objs[data.kn].prune_list.push(...data.prune_list);
                    });
                }
                await Promise.all(test_promises);
            }

            // let candidate_lists = Array.from(Array(k_means_depth), () => []);


            let best_of_best_results = [];

            if (optimizer_promises) {
                for (let p of optimizer_promises) {
                    p.then(data => {

                        // tracker(count++, promises.length, data);
                        console.log({data:data});
                        // let numberBig = false;
                        // if (data.output[0] > 200) numberBig = true;
                        // // if (p[0][0] > 200) numberBig = true;
                        // console.log({numberBig:numberBig});
                        // candidate_lists[data.kn].push(...data.return_list); // TODO: Potentially keep sublists for starting one verification thread per cluster thread  
                        susu_data_objs[data.kn].candidate_list.push(...data.return_list);
                        let t_height = 0;
                        for (let return_obj of data.return_list) {
                            if (return_obj.tower_fitness.length > t_height) {
                                best_of_best_results.push(return_obj);
                                t_height += 1;
                            }
                        }
                    });
                }
                await Promise.all(optimizer_promises);
            }

            // Add best_of_bests combination holder
            susu_data_objs.push({kn:k_means_depth, candidate_list:best_of_best_results, graph_edges_sets:[], verify_list:[], prune_list:[]});

            // Handle decoding geometry polys AFTER verification
            // for (let return_obj of data.return_list) {
            //     let decoded_geometry = kiri.codec.decode(return_obj.candidate_details.candidate_obj.geometry);
            //     return_obj.candidate_details.candidate_obj.geometry = decoded_geometry;
            //     for (let above of return_obj.aboves) {
            //         let decoded_geometry = kiri.codec.decode(above.candidate_details.candidate_obj.geometry);
            //         above.candidate_details.candidate_obj.geometry = decoded_geometry;
            //     }
            // }


            // let verify_lists = Array.from(Array(kiri.minions.concurrent), () => []);
            let verify_lists = Array.from(Array(susu_data_objs.length), () => []);

            console.log("Starting to prepare verification");

            // let combined_susu = {kn:5, candidate_list:[], graph_edges_sets:[], verify_list:[]};
            // let combined_promise = [];

            let worker_number = 0;
            for (let susu_data of susu_data_objs) {
                for (let candidate_index in susu_data.candidate_list) { // Add list indices 
                    // verify_lists[worker_number].push(candidate_index); // TODO: Separate work into multiple workers
                    susu_data.verify_list.push(candidate_index);
                    // worker_number++;
                    // if (worker_number >= kiri.minions.concurrent) {
                    // if (true) {
                    //     worker_number = 0;
                    // }
                }
                worker_number++;

                // combined_susu.candidate_list.push(...susu_data.candidate_list);
            }

            // for (let candidate_index in combined_susu.candidate_list) { // Add list indices 
            //     combined_susu.verify_list.push(candidate_index);
            // }
            // combined_promise.push(kiri.minions.verifyCandidateOverlap(combined_susu.verify_list, combined_susu.candidate_list, combined_susu.kn));
            // if (combined_promise) {
            //     for (let p of combined_promise) {
            //         p.then(data => {
            //             console.log({combined_verify_data:data});
            //             // graph_edges_sets.push(...data.graph_edges_lists);
            //             combined_susu.graph_edges_sets.push(...data.graph_edges_sets);
            //         });
            //     }
            //     await Promise.all(combined_promise);
            // }


            // let surrogated_slices = doSurrogates(surrogate_library, surrogate_settings, highest_slice, process, widget.shadow, settings, view, prisms_obj);
            // console.log({surro_settings:surro_settings}); 
            // widget.slices = surrogated_slices;

            console.log("Starting to verify overlaps");
           
            let verify_promises = [];
            // let just_one = true;
            // for (let verify_list of verify_lists) {
            for (let susu_data of susu_data_objs) {
                verify_promises.push(kiri.minions.verifyCandidateOverlap(susu_data.verify_list, susu_data.candidate_list, susu_data.kn));
                // if (just_one) verify_promises.push(kiri.minions.verifyCandidateOverlap(verify_list, candidate_list, kn));
                // just_one = false;
            }

            if (verify_promises) {
                for (let p of verify_promises) {
                    p.then(data => {
                        console.log({verify_data:data});
                        // graph_edges_sets.push(...data.graph_edges_lists);
                        susu_data_objs[data.kn].graph_edges_sets.push(...data.graph_edges_sets);
                        susu_data_objs[data.kn].prune_list.push(...data.prune_list);
                    });
                }
                await Promise.all(verify_promises);
            }

            // for (let susu_data of susu_data_objs) {
            //     for (let prune_idx of susu_data.prune_list) { // prune in reverse order
            //         // susu_data.candidate_list.splice(prune_idx, 1); // DON'T prune candidates, this invalidates the index numbers
            //         susu_data.graph_edges_sets.splice(prune_idx, 1);
            //         // susu_data.verify_list.splice(prune_idx, 1); // No longer relevant
            //         susu_data.verify_list = [];
            //     }
            //     console.log({pruned_edge_sets:susu_data.graph_edges_sets});
            // }

            console.log("Starting validation of combinations");

            // TODO TODO
            // TODO: decode candidates
            // TODO: Combine minion verify and validate calls, OR make verfiy run with extra threads
            // TODO: Increase min fitness for low quality search
            // TODO: Fix prism search
            // TODO: Adjust surrogate settings // Particle size generation
      
            let validate_promises = [];
            for (let susu_data of susu_data_objs) {
                validate_promises.push(kiri.minions.validateCombinations(susu_data.candidate_list, susu_data.graph_edges_sets, susu_data.prune_list, surrogate_settings, susu_data.kn));
            }

            if (validate_promises) {
                for (let p of validate_promises) {
                    p.then(data => {
                        console.log({validate_data:data});
                        susu_data_objs[data.kn].selection_list=data.final_selection_list;
                    });
                }
                await Promise.all(validate_promises);
            }


            let global_selection_list = [{final_fitness:0}, {final_fitness:0}, {final_fitness:0}]; // low, med, high interaction

            for (let data_obj of susu_data_objs) {
                for (let i = 0; i < 3; i++) {
                    if (global_selection_list[i].final_fitness < data_obj.selection_list[i].final_fitness) {
                        global_selection_list[i] = {
                            final_fitness: data_obj.selection_list[i].final_fitness,
                            result_fitness: data_obj.selection_list[i].result_fitness,
                            used_candidates: data_obj.selection_list[i].used_candidates,
                            best_kn: data_obj.kn
                        };
                    }
                }
            }

            console.log({global_selection_list:global_selection_list});
            
            // let index_array = [ ...Array(candidate_list.length).keys() ];

            // console.log({index_array:index_array});

            // var candidate_combinations = up_to_m_combinations(index_array, 4);

            // console.log({candidate_combinations:candidate_combinations});
            // let good_combinations_list = [[], [], [], []];
            
            // let good_combination = true;
            // for (let combination of candidate_combinations) {
            //     next_combination:
            //     for (let candidate_idx of combination) { // check if the graph edges that show whether two surrogates can be placed without overlap
            //         for (let candidate_idx2 of combination) {
            //             if (!graph_edges_sets[candidate_idx].has(candidate_idx2)) {
            //                 good_combination = false;
            //                 break next_combination;
            //             }
            //         }
            //     }
            //     if (good_combination)  {
            //         console.log({good_combination:combination});
            //         // let [ low_ia, med_ia, high_ia, max_ia ] = calculateCombinationFitnesses(combination); // TODO
            //         // candidate_combinations[0].push(low_ia);
            //         // candidate_combinations[1].push(med_ia);
            //         // candidate_combinations[2].push(high_ia);
            //         // candidate_combinations[3].push(max_ia);
            //     }
            //     good_combination = true;
            // }


            profileEnd();
            

            


            profileStart("support-fill");
            promises = false && isConcurrent ? [] : undefined;
            forSlices(0.8, promises ? 0.88 : 0.9, slice => {
                doSupportFill(promises, slice, lineWidth, supportDensity, process.sliceSupportArea, isBelt);
            }, "support");
            if (promises) {
                await tracker(promises, (i, t) => {
                    trackupdate(i / t, 0.88, 0.9);
                });
            }
            profileEnd();
        }

        // render if not explicitly disabled
        if (render) {
            forSlices(0.9, 1.0, slice => {
                let params = slice.params || process;
                doRender(slice, isSynth, params, controller.devel);
            }, "render");
        }

        if (isBelt) {
            let bounds = base.newBounds();
            for (let top of slices[0].tops) {
                bounds.merge(top.poly.bounds);
            }
            widget.belt.miny = -bounds.miny;
            widget.belt.midy = (bounds.miny + bounds.maxy) / 2;
        }
    }

    function getSimplePointsArray(pointArray, fromSimple) {
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
        // for (let i = 0; i < pointArray.length; i++) {
        //     simplePointsArray.push([pointArray[i].x, pointArray[i].y, pointArray[i].z]);
        // }
        return simplePointsArray;
    }

    function getEncodedData(bottom_slice) {
        let encodedData = [];
        let current_slice = bottom_slice;
        while (current_slice) {
            let encodedSlice = kiri.codec.encode(current_slice);
            let encodedTops = [];
            let encodedSupports = [];
            let sliceHeight = current_slice.height;

            for (let oneTop of current_slice.tops) {
                encodedTops.push(kiri.codec.encode(oneTop, {full: false}));
                // let encodededTop1 = kiri.codec.encode(oneTop, {full: true});
                // let encodededTop3 = kiri.codec.encode(oneTop);
                // let encodededTop2 = oneTop.encode({full: true});
                // // let encodededTop4 = oneTop.encode(true);
            }
            // for (let oneTop of current_slice.topPolys()) {
            //     encodedTops.push(kiri.codec.encode(oneTop, {full: true}));
            //     let encodededTop1 = kiri.codec.encode([oneTop], {full: true});
            //     let encodededTop3 = kiri.codec.encode(oneTop);
            //     let encodededTop2 = oneTop.encode({full: true});
            // }
            if (current_slice.supports) {
                // for (let oneSupport of current_slice.supports) {
                //     encodedSupports.push(kiri.codec.encode(oneSupport, {full: true}));
                //     // let encodedSupport = kiri.codec.encode(oneSupport, {full: true});
                //     // let encodedSupport2 = kiri.codec.encode(oneSupport);
                // }
                encodedSupports = kiri.codec.encode(current_slice.supports);
                // let encodedSupportList2 = kiri.codec.encode(current_slice.supports);
            }

            let sliceDetailList = [encodedSlice, encodedTops, encodedSupports, sliceHeight];
            encodedData.push(sliceDetailList);
            // sliceDetailList.push([current_slice.index, current_slice.z]);
            current_slice = current_slice.up;
        }
        return (encodedData);
    }

    function getSupportPoints(slice, proc, settings) {

        let bottom_slice = slice;
        // let last_bottom_slice;
        // while (bottom_slice) {
        //     last_bottom_slice = bottom_slice;
        //     bottom_slice = bottom_slice.down;
        // }

        // bottom_slice = last_bottom_slice;
        console.log({bottom_slice: bottom_slice});

        let search_density = 1;
        let search_padding = 0; // TODO: Adjust to size of surrogate/largest surrogate?
        // Search bounds
        const min_x = bottom_slice.widget.bounds.min.x - search_padding;
        const max_x = bottom_slice.widget.bounds.max.x + search_padding;
        const min_y = bottom_slice.widget.bounds.min.y - search_padding;
        const max_y = bottom_slice.widget.bounds.max.y + search_padding;

        let valid_points = [];
        // let supp_outline_points = [];
        if (!bottom_slice.supports || bottom_slice.supports.length === 0) {
        } else {
            for (let point_x = min_x; point_x < max_x; point_x += search_density) {
                for (let point_y = min_y; point_y < max_y; point_y += search_density) {
                    let test_point = newPoint(point_x, point_y, bottom_slice.z);
                    let point_valid = false;

                    for (let support_poly of bottom_slice.supports)  {
                    //bottom_slice.supports.forEach(function(support_poly) {
                        if (test_point.isInPolygon(support_poly)) { // TODO: inPolygon vs. isInPolygon checks for holes(children)
                            point_valid = true;
                            break;
                        }
                    }

                    //});
                    if (point_valid) {
                        valid_points.push(test_point);
                    }
                }
            }

            console.log({valid_points_length:valid_points.length});

            // Also add outlines of all polygons to get high fidelity clusters
            for (let support_poly of bottom_slice.supports)  {
                for (let point of support_poly.points) {
                    let test_point = newPoint(point.x, point.y, point.z);
                    valid_points.push(test_point);
                }
            }
            bottom_slice.support_points = valid_points;

            // Check how high supports are for each point
            let height_points = [...valid_points];
            // let height_points_outline = [...supp_outline_points]; // TODO: Faster to handle outline points differently? Compare points to all outline points directly?
            let next_slice = bottom_slice.up;
            while (next_slice) {
                let height_points_i = height_points.length;
                while(height_points_i--) {
                    if (next_slice.supports) {
                        let point_valid = false;
                        for (let support_poly of next_slice.supports)  {
                            if (height_points[height_points_i].isInPolygon(support_poly)) { // TODO: inPolygon vs. isInPolygon checks for holes(children)
                                point_valid = true;
                                break;
                            }
                        }
                        if (point_valid) {
                            height_points[height_points_i].z = next_slice.z;
                        } else {
                            height_points.splice(height_points_i, 1);
                        }
                    }
                }

                // height_points_i = height_points_outline.length;
                // while(height_points_i--) {
                //     if (next_slice.supports) {
                //         let point_valid = false;
                //         for (let support_poly of next_slice.supports)  {
                //             if (height_points_outline[height_points_i].nearPolygon(support_poly, 0.1, true)) { // check if point still on polygon outline (within distance), including inner polys
                //                 point_valid = true;
                //                 break;
                //             }
                //         }
                //         if (point_valid) {
                //             height_points_outline[height_points_i].z = next_slice.z;
                //         } else {
                //             height_points_outline.splice(height_points_i, 1);
                //         }
                //     }
                // }
                
                let points_slice_copy = [...height_points]; // Save remaining support points to slice
                next_slice.support_points = points_slice_copy;

                next_slice = next_slice.up;
            }
        }

        let simple_valid_p = getSimplePointsArray(valid_points, false);

        return [ valid_points, simple_valid_p ];
    }

    function getSupportPointsDebug(slice, proc, settings) {

        let bottom_slice = slice;
        // let last_bottom_slice;
        // while (bottom_slice) {
        //     last_bottom_slice = bottom_slice;
        //     bottom_slice = bottom_slice.down;
        // }

        // bottom_slice = last_bottom_slice;
        console.log({bottom_slice: bottom_slice});

        let search_density = 1;
        let search_padding = 0; // TODO: Adjust to size of surrogate/largest surrogate?
        // Search bounds
        const min_x = bottom_slice.widget.bounds.min.x - search_padding;
        const max_x = bottom_slice.widget.bounds.max.x + search_padding;
        const min_y = bottom_slice.widget.bounds.min.y - search_padding;
        const max_y = bottom_slice.widget.bounds.max.y + search_padding;

        let valid_points = [];
        // let supp_outline_points = [];
        if (!bottom_slice.supports || bottom_slice.supports.length === 0) {
        } else {
            for (let point_x = min_x; point_x < max_x; point_x += search_density) {
                for (let point_y = min_y; point_y < max_y; point_y += search_density) {
                    let test_point = newPoint(point_x, point_y, bottom_slice.z);
                    let point_valid = false;

                    for (let support_poly of bottom_slice.supports)  {
                    //bottom_slice.supports.forEach(function(support_poly) {
                        if (test_point.isInPolygon(support_poly)) { // TODO: inPolygon vs. isInPolygon checks for holes(children)
                            point_valid = true;
                            break;
                        }
                    }

                    //});
                    if (point_valid) {
                        valid_points.push(test_point);
                    }
                }
            }

            console.log({valid_points_length:valid_points.length});

            // Also add outlines of all polygons to get high fidelity clusters
            for (let support_poly of bottom_slice.supports)  {
                for (let point of support_poly.points) {
                    let test_point = newPoint(point.x, point.y, point.z);
                    valid_points.push(test_point);
                }
            }
            bottom_slice.support_points = valid_points;

            // Check how high supports are for each point
            let height_points = [...valid_points];
            // let height_points_outline = [...supp_outline_points]; // TODO: Faster to handle outline points differently? Compare points to all outline points directly?
            let next_slice = bottom_slice.up;
            while (next_slice) {
                let height_points_i = height_points.length;
                while(height_points_i--) {
                    if (next_slice.supports) {
                        let point_valid = false;
                        for (let support_poly of next_slice.supports)  {
                            if (height_points[height_points_i].isInPolygon(support_poly)) { // TODO: inPolygon vs. isInPolygon checks for holes(children)
                                point_valid = true;
                                break;
                            }
                        }
                        if (point_valid) {
                            height_points[height_points_i].z = next_slice.z;
                        } else {
                            height_points.splice(height_points_i, 1);
                        }
                    }
                }

                // height_points_i = height_points_outline.length;
                // while(height_points_i--) {
                //     if (next_slice.supports) {
                //         let point_valid = false;
                //         for (let support_poly of next_slice.supports)  {
                //             if (height_points_outline[height_points_i].nearPolygon(support_poly, 0.1, true)) { // check if point still on polygon outline (within distance), including inner polys
                //                 point_valid = true;
                //                 break;
                //             }
                //         }
                //         if (point_valid) {
                //             height_points_outline[height_points_i].z = next_slice.z;
                //         } else {
                //             height_points_outline.splice(height_points_i, 1);
                //         }
                //     }
                // }
                
                let points_slice_copy = [...height_points]; // Save remaining support points to slice
                next_slice.support_points = points_slice_copy;

                next_slice = next_slice.up;
            }
        }
        // valid_points.push(...supp_outline_points);
        console.log({valid_points:valid_points});

        // Calculate clusters.

        var kmeans = kiri.newKMeans();
        // var clusters = KMEANS.KMeans(colors, 3);
        // var clusters = kmeans.cluster(colors, 3);

        let simple_valid_p = getSimplePointsArray(valid_points, false);

        var clusters = kmeans.cluster(simple_valid_p, 2);

        //  var hull = new HULL.hull();
        // var colorHull = HULL.hull(colors2, 500);

        console.log({kiri:kiri});
        // console.log(kiri.hull());

        for (let cluster of clusters) {
            var cluster_2d = getSimplePointsArray(cluster, true);
            console.log({cluster_2d:cluster_2d});
            var new_hull = kiri.hull(cluster_2d, 100);
            console.log({new_hull:new_hull});


            if (!(bottom_slice.tops[0].fill_sparse)) {
                bottom_slice.tops[0].fill_sparse = [];
            }

            let hull_points = [];

            for (let simplePoint of new_hull) {
                let point = newPoint(simplePoint[0], simplePoint[1], bottom_slice.z);
                hull_points.push(point);
            }
            hull_points.pop();
            let debug_outline_poly = base.newPolygon(hull_points);
            console.log({debug_outline_poly:debug_outline_poly});
            bottom_slice.tops[0].fill_sparse.push(debug_outline_poly);


            

            // make debug rectangle
            function generateRectangleDEBUG(start_x, start_y, start_z, length, width, rot, padding, debug_slice) {
                // const halfLength = length*0.5;
                // const halfWidth = width*0.5;
                // let point1 = newPoint(start_x - halfLength, start_y - halfWidth, start_z);
                // let point2 = newPoint(start_x + halfLength, start_y - halfWidth, start_z);
                // let point3 = newPoint(start_x + halfLength, start_y + halfWidth, start_z);
                // let point4 = newPoint(start_x - halfLength, start_y + halfWidth, start_z);
                // let rect_points = [point1, point2, point3, point4];
                // let rectanglePolygon = base.newPolygon(rect_points);
                // rectanglePolygon = rectanglePolygon.rotateXY(rot);
                // //rectanglePolygon.parent = top.poly;
                // rectanglePolygon.depth = 0;
                // rectanglePolygon.area2 = length * width * -2; // This winding direction is negative
            
                // let rectanglePolygon_padded = [];
                // rectanglePolygon_padded = POLY.expand([rectanglePolygon], padding, start_z, rectanglePolygon_padded, 1); 
                // return rectanglePolygon_padded[0];
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


            let debugint = Math.floor(Math.random()*(debug_outline_poly.length-1))+1;
            // for (let debugint = 1; debugint < debug_outline_poly.length; debugint++) {
            // let x_dir = debug_outline_poly.points[debugint-1].x - debug_outline_poly.points[debugint].x;
            // let y_dir = debug_outline_poly.points[debugint-1].y - debug_outline_poly.points[debugint].y;

            // let hull_rot = Math.atan2(y_dir, x_dir)*180/Math.PI+180;

            // let hull_rot_90 = hull_rot + 90;

            // let one_candidate = generateRectangleDEBUG(debug_outline_poly.points[debugint-1].x, debug_outline_poly.points[debugint-1].y, bottom_slice.z, 20, 10, hull_rot, 0.4, bottom_slice);
            // bottom_slice.tops[0].fill_sparse.push(one_candidate);
            // let one_candidate2 = generateRectangleDEBUG(debug_outline_poly.points[debugint].x, debug_outline_poly.points[debugint].y, bottom_slice.z, 20, 10, hull_rot_90, 0.4, bottom_slice);
            // bottom_slice.tops[0].fill_sparse.push(one_candidate2);


            let x_dir = hull_points[debugint-1].x - hull_points[debugint].x;
            let y_dir = hull_points[debugint-1].y - hull_points[debugint].y;

            let hull_rot = Math.atan2(y_dir, x_dir)*180/Math.PI+180;

            let hull_rot_90 = hull_rot + 90;

            let one_candidate = generateRectangleDEBUG(hull_points[debugint-1].x, hull_points[debugint-1].y, bottom_slice.z, 20, 10, hull_rot, 0.4, bottom_slice);
            bottom_slice.tops[0].fill_sparse.push(one_candidate);
            let one_candidate2 = generateRectangleDEBUG(hull_points[debugint].x, hull_points[debugint].y, bottom_slice.z, 20, 10, hull_rot_90, 0.4, bottom_slice);
            bottom_slice.tops[0].fill_sparse.push(one_candidate2);
            // }
        }

        let slice_debug_counter = 0;
        let a_slice = bottom_slice;
        while (a_slice.up && slice_debug_counter < 100) {
            a_slice = a_slice.up;
            slice_debug_counter++;
        }

        console.log({support_points_save:a_slice.support_points});

        return [ valid_points, simple_valid_p ];

    }

    /**
     * Calculate height range of the slice
     * @return {float, float} top and bottom height of the slice 
     */
     function get_height_range(slice) {
        let top_height = slice.z + slice.height/2;
        let bottom_height = slice.z - slice.height/2;
        return {top_height:top_height, bottom_height:bottom_height};
    }

    /**
     * Calculate Z and height of slice based of target top and bottom heights
     * @return {float, float} Z and Height of the slice 
     */
    function get_slice_height_values(top_height, bottom_height, force_droop_from_head_at_top_height) {
        let height = top_height - bottom_height;
        let z;
        if (force_droop_from_head_at_top_height) z = top_height;// + 0.0042;
        else z = (top_height + bottom_height) / 2;
        return {z:z, height:height};
    }


    function simple_insertion_case_check(surrogate, precomputed_slice_heights) {
        for (let sliceIndex = 0; sliceIndex < precomputed_slice_heights.length-1; sliceIndex++){
            if (precomputed_slice_heights[sliceIndex].stopAbove >= surrogate.end_height) {
                surrogate.insertion_data.new_layer_index = sliceIndex;
                break;
            }
        }
    }

    function get_all_surrogates_on_top(surrogate, previous_list) {
        surrogate.up_surrogate.forEach(function(upSupp) {
            previous_list.push(upSupp);
        });
        surrogate.up_surrogate.forEach(function(upSupp) {
            previous_list = get_all_surrogates_on_top(upSupp, previous_list);
        });
        return previous_list;
    }


    /**
     * Determine the best slice to pause the print and insert the surrogate
     * as well as how to adjust the surrounding slices to make the insertion smooth.
     * Expands the surrogate object with the case info directly.
     */
    function check_surrogate_insertion_case(surrogate, first_search_slice, surrogate_settings) {
        // Determine the insertion case for surrogate
        let case_determined = false;
        // console.log({Status:"Checking surrogate case handling"});
        // console.log({surrogate:surrogate});
        let iterate_layers_case_check = first_search_slice;
        while (iterate_layers_case_check && !case_determined) {
            let slice_height_range = get_height_range(iterate_layers_case_check);
            // let up_slice_height_range;
            // let skipCaseNot = false;
            // if (iterate_layers_case_check.up) {
            //     skipCaseNot = true;
            //     up_slice_height_range = get_height_range(iterate_layers_case_check.up);
            // }

            // Case 1: Extend the printed layer
            // The top end of the surrogate extends slightly into the new layer, or is perfectly on the same height
            // if (slice_height_range.bottom_height <= surrogate.end_height && (slice_height_range.bottom_height + surrogate_settings.min_squish_height) >= surrogate.end_height) {
            // Min_squish_height should be measured down from print-head height, which is z (instead of up from layer intersection)
            if (slice_height_range.bottom_height <= surrogate.end_height && (iterate_layers_case_check.z - surrogate_settings.min_squish_height) >= surrogate.end_height) {
                // console.log({Status:"Case1 Extend printed layer"});
                surrogate.insertion_data.insertion_case = "extend_printed_layer";
                surrogate.insertion_data.max_height = surrogate.end_height;
                surrogate.insertion_data.new_layer_index = iterate_layers_case_check.index;
                if (iterate_layers_case_check.down) surrogate.insertion_data.printed_layer_index = iterate_layers_case_check.down.index;
                else {
                    console.log({WARNING:"Tried to save the slice of the printed layer, but none was found."})
                    console.log({WARNING_additional_data:surrogate.insertion_data});
                }
                case_determined = true;
            }
            // Case 2: Extend the new layer
            // The top end of the surrogate rests slightly below where the new layer would normally start
            else if (slice_height_range.bottom_height > surrogate.end_height && (slice_height_range.bottom_height - surrogate_settings.max_extra_droop_height) <= surrogate.end_height) {
                // console.log({Status:"Case2 Extend new layer"});
                surrogate.insertion_data.insertion_case = "extend_new_layer";
                surrogate.insertion_data.min_height = surrogate.end_height;
                surrogate.insertion_data.new_layer_index = iterate_layers_case_check.index;
                if (iterate_layers_case_check.down) surrogate.insertion_data.printed_layer_index = iterate_layers_case_check.down.index;
                else {
                    console.log({WARNING:"Tried to save the slice of the printed layer, but none was found."})
                    console.log({WARNING_additional_data:surrogate.insertion_data});
                }
                case_determined = true;
            }
            // Case 3: Insert new support layer
            // The top of the surrogate is far below the start of the new layer, so we will add an additional (support-only) layer 
            else if (iterate_layers_case_check.down) {
                let down_slice_height_range = get_height_range(iterate_layers_case_check.down);
                if (down_slice_height_range.bottom_height < surrogate.end_height && down_slice_height_range.top_height > surrogate.end_height) {
                    // console.log({Status:"Case3 Insert new support layer"});
                    surrogate.insertion_data.insertion_case = "Insert_new_support_layer";
                    surrogate.insertion_data.min_height = surrogate.end_height;
                    surrogate.insertion_data.original_supports = [];
                    if (iterate_layers_case_check.down.supports) {
                        iterate_layers_case_check.down.supports.forEach(function(supp) {
                            surrogate.insertion_data.original_supports.push(supp.clone(true)); // Save original supports
                        });
                    }
                    // console.log({surrogate_original_supports:surrogate.insertion_data.original_supports});
                    surrogate.insertion_data.new_layer_index = iterate_layers_case_check.index;
                    surrogate.insertion_data.printed_layer_index = iterate_layers_case_check.down.index;
                    case_determined = true;
                }
            }
            iterate_layers_case_check = iterate_layers_case_check.up;
        }
        if (!case_determined) {
            console.log({WARNING:"WARNING: No case found for surrogate height handling."});
            // console.log({surrogate:surrogate});
        }
        
    }

    function getSurrogateLibrary(prisms) {
        let surrogates = [];
        // surrogates.push({width:100.5, length:152.7, height:10.9});
        // surrogates.push({width:136.8, length:190.1, height:24.1});


        function addOption(listOfOptions, length, width, height, title) {
            listOfOptions.push({width:width, length:length, height:height, minHeight:height, maxHeight:height, id:title, available:true, type:"simpleRectangle"});
        }

        function addStackableOptions(listOfOptions, initialHeight, addHeight, available, length, width, title) {
            const maxHeight = initialHeight + (addHeight*available);
            listOfOptions.push({width:width, length:length, height:initialHeight, minHeight:initialHeight, maxHeight:maxHeight, addHeight:addHeight, addMaxNumber:available, id:title, available:true, type:"stackable"});
            
            // while (stackHeight < settings.device.maxHeight && stackedSoFar < available) { 
            //     addOption(listOfOptions, length, width, stackHeight, title);
            //     stackHeight = stackHeight + addHeight;
            //     stackedSoFar++;
            // }
        }

        function addPrism(listOfOptions, prism_bottom_obj, prism_obj) {
            const getPrismSize = generatePrismPolygon(0, 0, 0, prism_obj.geometry_points, 0, 0.1);
            const PrismWidth = getPrismSize.bounds.maxy - getPrismSize.bounds.miny;
            const PrismLength = getPrismSize.bounds.maxx - getPrismSize.bounds.minx;

            listOfOptions.push({width:PrismWidth, length:PrismLength, height:prism_obj.ini_height, minHeight:prism_obj.ini_height, maxHeight:prism_obj.ini_height+prism_obj.extension_range, id:prism_obj.name, available:true, type:"prism", prism_geometry:prism_obj.geometry_points, bottom_geometry:prism_bottom_obj.geometry_points});
            // debug
            // listOfOptions.push({width:PrismWidth, length:PrismLength, height:minimum_prism_height, minHeight:minimum_prism_height, maxHeight:minimum_prism_height+prism_obj.extension_range, id:".", available:true, type:"prism", prism_geometry:prism_obj.geometry_points});
    
        }
        
        // Autosort this and use old automated stackable add method...

        addOption(surrogates, 93.8, 89.9, 3.33, "floppyx1");
        addOption(surrogates, 154.3, 105, 5.35, "saw plate");
        // addOption(surrogates, 137.5, 55.57, 6.62, "wood plate");
        // addOption(surrogates, 208.8, 164, 6.66, "wood plate large");
        // addOption(surrogates, 93.8, 89.9, 6.66, "floppyx2");
        // addOption(surrogates, 128.52, 68.25, 8.75, "medium dense foam plate");

        // addOption(surrogates, 73, 10.43, 9.5, "support bar");
        // // addOption(surrogates, 93.8, 89.9, 9.99, "floppyx3");
        addOption(surrogates, 44.35, 18.33, 10.16, "wood bar4"); // addOption(surrogates, 44.35, 18.33, 10.16, "wood bar dirty");
        addOption(surrogates, 49.8, 47.4, 10.5, "blue support");
        addOption(surrogates, 27.31, 23.75, 10.55, "support flat");
        // addOption(surrogates, 97, 18.35, 11.18, "wood bar3"); //addOption(surrogates, 97, 18.35, 11.18, "wood bar two holes");
        // addOption(surrogates, 100.75, 18.52, 12.2, "wood bar2"); // addOption(surrogates, 100.75, 18.52, 12.2, "wood bar math");

        addOption(surrogates, 31.85, 15.9, 12.75, "Lego 4x2x1");

        // // addOption(surrogates, 31.85, 31.85, 12.75, "Lego 4x4x1");
        // // addOption(surrogates, 63.77, 31.85, 12.75, "Lego 8x4x1");
        // // addOption(surrogates, 93.8, 89.9, 13.32, "floppyx4");
        // // addOption(surrogates, 31.85, 15.9, 15.9, "Lego 4x2x1.3");
        // // addOption(surrogates, 31.85, 31.85, 15.9, "Lego 4x4x1.3");
        // // addOption(surrogates, 63.77, 31.85, 15.9, "Lego 8x4x1.3");
        // addOption(surrogates, 68.26, 50.46, 13.1, "wood flat");
        // // addOption(surrogates, 183.5, 80.1, 14.7, "foam plate");
        // addOption(surrogates, 45.15, 23.35, 14.82, "dark wood");
        // // addOption(surrogates, 93.8, 89.9, 16.65, "floppyx5");
        // addOption(surrogates, 51, 25, 18.55, "wood offcut1"); // addOption(surrogates, 51, 25, 18.55, "wood man hair");
        // addOption(surrogates, 52.22, 24.9, 18.6, "wood bar");
        // addOption(surrogates, 50.4, 24.95, 18.62, "wood offcut2"); // addOption(surrogates, 50.4, 24.95, 18.62, "wood man");
        // addOption(surrogates, 25.05, 25.05, 18.8, "wood cube"); // addOption(surrogates, 25.05, 25.05, 18.8, "cube with dent");
        // // addOption(surrogates, 93.8, 89.9, 19.98, "floppyx6");
        // // addOption(surrogates, 31.85, 15.9, 22.3, "Lego 4x2x2");
        // // addOption(surrogates, 31.85, 31.85, 22.3, "Lego 4x4x2");
        // // addOption(surrogates, 63.77, 31.85, 22.3, "Lego 8x4x2");
        // // addOption(surrogates, 93.8, 89.9, 23.31, "floppyx7");
        // // addOption(surrogates, 24.4, 24.4, 24.4, "XYZ cube filled");
        // // addOption(surrogates, 31.85, 15.9, 25.45, "Lego 4x2x2.3");
        // // addOption(surrogates, 31.85, 31.85, 25.45, "Lego 4x4x2.3");
        // // addOption(surrogates, 63.77, 31.85, 25.45, "Lego 8x4x2.3");
        // // addOption(surrogates, 93.8, 89.9, 26.64, "floppyx8");
        // // addOption(surrogates, 93.8, 89.9, 29.97, "floppyx9");
        // addOption(surrogates, 49.8, 47.4, 30.5, "blue support big");
        // addOption(surrogates, 80.0, 70.0, 50.5, "cardboard box 1");
        // // addOption(surrogates, 31.85, 15.9, 31.85, "Lego 4x2x3");
        // // addOption(surrogates, 31.85, 31.85, 31.85, "Lego 4x4x3");
        // // addOption(surrogates, 63.77, 31.85, 31.85, "Lego 8x4x3");
        // // addOption(surrogates, 31.85, 15.9, 35, "Lego 4x2x3.3");
        // // addOption(surrogates, 31.85, 31.85, 35, "Lego 4x4x3.3");
        // // addOption(surrogates, 63.77, 31.85, 35, "Lego 8x4x3.3");
        // // addOption(surrogates, 110.1, 101.75, 37.15, "mpow box");
        // // addOption(surrogates, 172.5, 144.6, 37.3, "scale box");
        // // addOption(surrogates, 31.85, 15.9, 41.4, "Lego 4x2x4");
        // // addOption(surrogates, 31.85, 31.85, 41.4, "Lego 4x4x4");
        // // addOption(surrogates, 63.77, 31.85, 41.4, "Lego 8x4x4");
        // // addOption(surrogates, 31.85, 15.9, 44.55, "Lego 4x2x4.3");
        // // addOption(surrogates, 31.85, 31.85, 44.55, "Lego 4x4x4.3");
        // // addOption(surrogates, 63.77, 31.85, 44.55, "Lego 8x4x4.3");

        addOption(surrogates, 63.77, 31.85, 63.65, "Lego 8x4x6.3");
        // addPrism(surrogates, prisms[0], prisms[1]);
        // addPrism(surrogates, prisms[0], prisms[1]);

        // addStackableOptions(surrogates, 12.75, 9.55, 4, 31.85, 15.9, "Lego 4x2");
        // addOption(surrogates, 126.35, 125.6, 52.32, "leap box");
        // addPrism(surrogates, prisms[0], prisms[2]);
        // addPrism(surrogates, prisms[0], prisms[2]);
        // addPrism(surrogates, prisms[0], prisms[2]);
        
        // addStackableOptions(surrogates, 15.9, 9.55, 4, 31.85, 15.9, "Lego+4x2");
        // addStackableOptions(surrogates, 12.75, 9.55, 5, 31.85, 31.85, "Lego 4x4");
        // addStackableOptions(surrogates, 15.9, 9.55, 5, 31.85, 31.85, "Lego+4x4");
        // addStackableOptions(surrogates, 12.75, 9.55, 6, 63.77, 31.85, "Lego 4x8");
        // addStackableOptions(surrogates, 15.9, 9.55, 6, 63.77, 31.85, "Lego+4x8");
        // for (let i = 1; i < prisms.length; i++){
        //     addPrism(surrogates, prisms[0], prisms[i]);
        // }
        // addStackableOptions(surrogates, 9.99, 3.33, 6, 93.8, 89.9, "FloppyDisc");
        // for (let i = 1; i < prisms.length; i++){
        //     addPrism(surrogates, prisms[0], prisms[i]);
        // }
        return surrogates;
    }


    /**
     * Simplifies mesh and support polygons
     * Sets/determines surrogate settings
     */
    function prepareSurrogating(library_in, slice, proc, settings) {
        if (true)
        {
            console.log({status:"Preparing surrogate search"});
        }

        let surros = library_in;
    
        let minArea = proc.supportMinArea,
            min = minArea || 0.01,
            ctre = new ClipperLib.PolyTree();
        // create inner clip offset from tops
        //POLY.expand(tops, offset, slice.z, slice.offsets = []);

        let bottom_slice = slice.down;
        let last_bottom_slice;

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

        function adaptivePolySimplify(flatFactor, logFactor, poly, perimeterLength, prevArea2, zed, mina, coff) {
            const averageLineLength = perimeterLength / poly.length;
            // const LengthPerArea = Math.abs(poly.area2)/averageLineLength;)
            let checkOut = false;

            if (averageLineLength < 2.0 && poly.length > 10) {
                coff = new ClipperLib.ClipperOffset();
                const simplification_factor = 2182.24*flatFactor * Math.log(16.1379*logFactor * averageLineLength);
                let inputPolyClipped = poly.toClipper();
                inputPolyClipped = ClipperLib.Clipper.CleanPolygons(inputPolyClipped, simplification_factor);
                // inputPolyClipped= ClipperLib.Clipper.SimplifyPolygons(inputPolyClipped, 1);

                // const newLength = inputPolyClipped[0].length;
                // const newALL = perimeterLength / newLength;
                // if (newLength > 100 || newLength < 4 || newALL > 6 || newALL < 1.0) {
                //     console.log({WARNING:"Check simplification result"});
                //     console.log({poly:poly});
                //     console.log({inputPolyClipped:inputPolyClipped});
                //     console.log({newALL:newALL});
                //     console.log({oldAll:averageLineLength});
                //     console.log({perimeterLength:perimeterLength});
                //     console.log({inputPolyClippedLength:newLength});
                //     checkOut = true;
                // }

                // if (inputPolyClipped.length > 0) {
                //     for (let justIterate = 0; justIterate < inputPolyClipped[0].length; justIterate += 1) {
                //         inputPolyClipped[0][justIterate].Y += 1000000;
                //     }
                // }

                coff.AddPaths(inputPolyClipped, 2, 4);
                coff.Execute(ctre, 0);
                let outputPolys = POLY.fromClipperTree(ctre, zed, null, null, mina);

                

                if (outputPolys.length > 0) {
                    outputPolys[0].area2 = outputPolys[0].area(true);
                    // if (Math.abs(Math.abs(outputPolys[0].area2) - Math.abs(prevArea2) > 5)) {
                    //     console.log({WARNING:"Area after simplifying top polygon changed a lot."});
                    //     console.log("Simplified_area: " + outputPolys[0].area2.toString());
                    //     console.log("Original_area: " + prevArea2.toString());
                    //     checkOut = true;
                    //     for (let justIterate = 0; justIterate < outputPolys[0].points.length; justIterate += 1) {
                    //         outputPolys[0].points[justIterate].Y += 10000000;
                    //         outputPolys[0].points[justIterate].y += 100;
                    //     }
                    // }
                    if (outputPolys.length > 1) {
                        // console.log({WARNING:"More than one output poly after simplification."});
                        // console.log({outputPolys:outputPolys});
                        checkOut = true;
                        
                        outputPolys[0].points.push(...outputPolys[1].points); // TODO: Handle this more cleanly
                        // for (let justIterate = 0; justIterate < outputPolys[0].points.length; justIterate += 1) {
                        //     outputPolys[0].points[justIterate].Y += 10000000;
                        //     outputPolys[0].points[justIterate].y += 100;
                        // }
                    }
                    outputPolys[0].checkOut = checkOut;
                    return outputPolys[0];
                }
                else {

                    // for (let justIterate = 0; justIterate < poly.length; justIterate += 1) {
                    //     poly.points[justIterate].Y += 600000;
                    //     poly.points[justIterate].y += 6;
                    // }
                    // console.log({WARNING:"Clipper returned empty polygon"});
                    // console.log({outputPolys:outputPolys});
                    // console.log({poly:poly});
                    // console.log({inputPolyClipped:inputPolyClipped});
                    // console.log({oldAll:averageLineLength});
                    checkOut = true;
                    poly.checkOut = checkOut;
                    return poly;
                }
            }
            else {
                poly.perim = perimeterLength;
                poly.area2 = prevArea2;
                poly.checkOut = checkOut;
                return poly;
            }
        }

        function adaptivePolySimplifyList(flatFactor, logFactor, poly, perimeterLength, prevArea2, zed, mina, coff) {
            const averageLineLength = perimeterLength / poly.length;
            // const LengthPerArea = Math.abs(poly.area2)/averageLineLength;)
            let checkOut = false;

            if (averageLineLength < 2.0 && poly.length > 10) {
                coff = new ClipperLib.ClipperOffset();
                const simplification_factor = 2182.24*flatFactor * Math.log(16.1379*logFactor * averageLineLength);
                let inputPolyClipped = poly.toClipper();
                inputPolyClipped = ClipperLib.Clipper.CleanPolygons(inputPolyClipped, simplification_factor);
                // inputPolyClipped= ClipperLib.Clipper.SimplifyPolygons(inputPolyClipped, 1);

                // const newLength = inputPolyClipped[0].length;
                // const newALL = perimeterLength / newLength;
                // if (newLength > 100 || newLength < 4 || newALL > 6 || newALL < 1.0) {
                //     console.log({WARNING:"Check simplification result"});
                //     console.log({poly:poly});
                //     console.log({inputPolyClipped:inputPolyClipped});
                //     console.log({newALL:newALL});
                //     console.log({oldAll:averageLineLength});
                //     console.log({perimeterLength:perimeterLength});
                //     console.log({inputPolyClippedLength:newLength});
                //     checkOut = true;
                // }

                // if (inputPolyClipped.length > 0) {
                //     for (let justIterate = 0; justIterate < inputPolyClipped[0].length; justIterate += 1) {
                //         inputPolyClipped[0][justIterate].Y += 1000000;
                //     }
                // }

                coff.AddPaths(inputPolyClipped, 2, 4);
                coff.Execute(ctre, 0);
                let outputPolys = POLY.fromClipperTree(ctre, zed, null, null, mina);

                

                if (outputPolys.length > 0) {
                    outputPolys[0].area2 = outputPolys[0].area(true);
                    if (Math.abs(Math.abs(outputPolys[0].area2) - Math.abs(prevArea2) > 5)) {
                        console.log({WARNING:"Area after simplifying top polygon changed a lot."});
                        console.log("Simplified_area: " + outputPolys[0].area2.toString());
                        console.log("Original_area: " + prevArea2.toString());
                    }
                    if (outputPolys.length > 1) {
                        console.log({WARNING:"More than one output poly after simplification."});
                        console.log({outputPolys:outputPolys});
                        checkOut = true;
                        
                        outputPolys[0].points.push(...outputPolys[1].points);


                        for (let justIterate = 0; justIterate < outputPolys[0].points.length; justIterate += 1) {
                            outputPolys[0].points[justIterate].Y += 2000000;
                            outputPolys[0].points[justIterate].y += 20;
                        }
                    }
                    outputPolys[0].checkOut = checkOut;
                    return outputPolys[0];
                }
                else {

                    // for (let justIterate = 0; justIterate < poly.length; justIterate += 1) {
                    //     poly.points[justIterate].Y += 600000;
                    //     poly.points[justIterate].y += 6;
                    // }
                    console.log({WARNING:"Clipper returned empty polygon"});
                    console.log({outputPolys:outputPolys});
                    console.log({poly:poly});
                    console.log({inputPolyClipped:inputPolyClipped});
                    console.log({oldAll:averageLineLength});
                    checkOut = true;
                    poly.checkOut = checkOut;
                    return poly;
                }
            }
            else {
                poly.perim = perimeterLength;
                poly.area2 = prevArea2;
                poly.checkOut = checkOut;
                return poly;
            }
        }

        let otherWidget;
        
        while (bottom_slice) {
            last_bottom_slice = bottom_slice;
            bottom_slice = bottom_slice.down;
            if (!otherWidget) { // The second widget has the manual support pillars 
                try {
                    const thisWidgetID = bottom_slice.widget.id;
                    for (let widInd = 0; widInd < bottom_slice.widget.group.length; widInd +=1 ) {
                        if (bottom_slice.widget.group[widInd].id != thisWidgetID)  {
                            otherWidget = bottom_slice.widget.group[widInd]; // Get widget with manual supports
                            break;
                        }
                    }
                }
                catch { } // We don't care if there is none
            }
        }

        bottom_slice = last_bottom_slice;
        console.log({bottom_slice: bottom_slice});

        let up = bottom_slice;

        if (!bottom_slice.tops[0].fill_sparse) bottom_slice.tops[0].fill_sparse = [];

        bottom_slice.efficiencyData = {numberPauses:0, numberSurrogates:0, materialWeightEstimateTube: 0, materialWeightEstimateBar: 0, materialWeightEstimateEllipse: 0, timestamp:0, id:0, previous_volume:0, new_volume:0, volume_percentage_saved:0}; 

        let surrogate_settings = {};

        surrogate_settings.minSupportArea = proc.supportMinArea;

        // Have all settings available in parallel
        surrogate_settings.interaction_N_penalty_factor_high = 0.0;
        surrogate_settings.surrogate_N_penalty_factor_high = 0.0;
        surrogate_settings.interaction_N_penalty_factor_med = 0.3;
        surrogate_settings.surrogate_N_penalty_factor_med = 0.65;
        surrogate_settings.interaction_N_penalty_factor_low = 0.35;
        surrogate_settings.surrogate_N_penalty_factor_low = 0.8;


        if (proc.surrogateInteraction == "off") {
            surrogate_settings.minVolume = 10;
            surrogate_settings.interaction_N_penalty_factor = 0;
            surrogate_settings.surrogate_N_penalty_factor = 0;
            surrogate_settings.searchspace_min_number_of_surrogates = 0;
            surrogate_settings.surrogateInteraction = "off";
        } else if(proc.surrogateInteraction == "low") {
            surrogate_settings.minVolume = 100;
            surrogate_settings.interaction_N_penalty_factor = 0.35;
            surrogate_settings.surrogate_N_penalty_factor = 0.8;
            surrogate_settings.searchspace_min_number_of_surrogates = 2;
            surrogate_settings.surrogateInteraction = "low";
        } else if(proc.surrogateInteraction == "medium") {
            surrogate_settings.minVolume = 50;
            surrogate_settings.interaction_N_penalty_factor = 0.3;
            surrogate_settings.surrogate_N_penalty_factor = 0.65;
            surrogate_settings.searchspace_min_number_of_surrogates = 3;
            surrogate_settings.surrogateInteraction = "medium";
        } else if(proc.surrogateInteraction == "high") {
            surrogate_settings.minVolume = 10;
            surrogate_settings.interaction_N_penalty_factor = 0.0;
            surrogate_settings.surrogate_N_penalty_factor = 0.0;
            surrogate_settings.searchspace_min_number_of_surrogates = 5;
            surrogate_settings.surrogateInteraction = "high";
        }

        if (proc.surrogateSearchQual == "fastest") {
            surrogate_settings.exploration_factor = 0.3;
            surrogate_settings.simplification_factor = 4.0;
            surrogate_settings.search_persistance = 4;
            surrogate_settings.minImprovementPercentage = 0.08;
            surrogate_settings.numberOfParticles = 10;
            surrogate_settings.searchspace_max_number_of_surrogates = 4;
            surrogate_settings.surrogateSearchQual = "fastest";
            
        } else if(proc.surrogateSearchQual == "fair") {
            surrogate_settings.exploration_factor = 0.2;
            surrogate_settings.simplification_factor = 3.5;
            surrogate_settings.search_persistance = 5;
            surrogate_settings.minImprovementPercentage = 0.04;
            surrogate_settings.numberOfParticles = 15;
            surrogate_settings.searchspace_max_number_of_surrogates = 5;
            surrogate_settings.surrogateSearchQual = "fair";

        } else if(proc.surrogateSearchQual == "good") {
            surrogate_settings.exploration_factor = 0.12;
            surrogate_settings.simplification_factor = 3;
            surrogate_settings.search_persistance = 5;
            surrogate_settings.minImprovementPercentage = 0.015;
            surrogate_settings.numberOfParticles = 20;
            surrogate_settings.searchspace_max_number_of_surrogates = 6;
            surrogate_settings.surrogateSearchQual = "good";

        } else if(proc.surrogateSearchQual == "best") {
            surrogate_settings.exploration_factor = 0.0;
            surrogate_settings.simplification_factor = 2.5;
            surrogate_settings.search_persistance = 8;
            surrogate_settings.minImprovementPercentage = 0.01;
            surrogate_settings.numberOfParticles = 30;//275;
            surrogate_settings.searchspace_max_number_of_surrogates = 7;
            surrogate_settings.surrogateSearchQual = "best";
        }

        console.log({surrogateSearchQual:proc.surrogateSearchQual});
        console.log({surrogateInteraction:proc.surrogateInteraction});

        let search_padding = 50; // TODO: Adjust to size of surrogate/largest surrogate?
        // Search bounds
        const min_x = bottom_slice.widget.bounds.min.x - search_padding;
        const max_x = bottom_slice.widget.bounds.max.x + search_padding;
        const min_y = bottom_slice.widget.bounds.min.y - search_padding;
        const max_y = bottom_slice.widget.bounds.max.y + search_padding;
        const bedDepthArea = settings.device.bedDepth / 2;
        const bedWidthArea = settings.device.bedWidth / 2;
        const shift_x = bottom_slice.widget.track.pos.x;
        const shift_y = bottom_slice.widget.track.pos.y;

        console.log({bedDepthArea:bedDepthArea});
        console.log({bedWidthArea:bedWidthArea});

        console.log({shift_x:shift_x});
        console.log({shift_y:shift_y});

        let rotations = [0,45,90,135,180,225,270,315];
        let layer_height_fudge = settings.process.sliceHeight/1.75;
        let print_on_surrogate_extra_height_for_extrusion = 0;
        surrogate_settings.surrogate_padding = 0.1;
        surrogate_settings.min_squish_height = settings.process.sliceHeight/4;
        surrogate_settings.max_extra_droop_height = settings.process.sliceHeight/4;
        surrogate_settings.minimum_clearance_height = settings.process.sliceHeight/4;
        surrogate_settings.rotations = rotations;
        surrogate_settings.print_on_surrogate_extra_height_for_extrusion = print_on_surrogate_extra_height_for_extrusion;
        surrogate_settings.layer_height_fudge = layer_height_fudge;
        surrogate_settings.start_slice = bottom_slice;
        surrogate_settings.existing_surrogates = [];
        surrogate_settings.number_of_vars = 6; // Number of variables per surrogate PSO test
        surrogate_settings.average_so_far = 0;

        surrogate_settings.fitness_offset = 0;
        
        surrogate_settings.best_valid = 0;
        surrogate_settings.leniency = 1.0;

        surrogate_settings.text_size = proc.surrogateTextSize;

        // surrogate_settings.minVolume = 10;
        surrogate_settings.skimPercentage = 0.05;

        surrogate_settings.allow_towers = proc.surrogateTowers;
        // surrogate_settings.allow_height_variable = true;
        // surrogate_settings.allow_stackable = true;
        

        let all_slices = [];
        surrogate_settings.all_slices = all_slices;
        surrogate_settings.precomputed_slice_heights = [];
        surrogate_settings.pauseLayers = [];

        surrogate_settings.smallest_length = Infinity;
        surrogate_settings.smallest_width = Infinity;
        surrogate_settings.smallest_height = Infinity;
        surrogate_settings.biggest_length = 0;
        surrogate_settings.biggest_width = 0;
        surrogate_settings.biggest_height = 0;

        for (let surro of surros) {
            if (surrogate_settings.smallest_length > surro.length) {
                surrogate_settings.smallest_length = surro.length;
            }
            if (surrogate_settings.smallest_width > surro.width) {
                surrogate_settings.smallest_width = surro.width;
            }
            if (surrogate_settings.smallest_height > surro.minHeight) {
                surrogate_settings.smallest_height = surro.minHeight;
            }
            if (surrogate_settings.biggest_length < surro.length) {
                surrogate_settings.biggest_length = surro.length;
            }
            if (surrogate_settings.biggest_width < surro.width) {
                surrogate_settings.biggest_width = surro.width;
            }
            if (surrogate_settings.biggest_height < surro.maxHeight) {
                surrogate_settings.biggest_height = surro.maxHeight;
            }
        }
    
        let mina = min; //numOrDefault(min, 0.1);
        let coff = new ClipperLib.ClipperOffset();
        const unreachable_poly = generateRectanglePolygonCentered(1000, 1000, 1000, 10, 10, 0, 0, bottom_slice);
            
        // Simplification of polys
        while (up) {
            if (proc.surrogateInteraction != "off") {
                let zed = up.z || 0;

                // console.log({up:up});
                // if (up.tops) {
                //     let overlap_found = false;
                //     if (up.tops.length > 1) {
                //         for (let topsIndex = 0; topsIndex < up.tops.length; topsIndex+=1) {
                //             for (let topsIndex2 = 0; topsIndex2 < up.tops.length; topsIndex2+=1) {
                //                 if (topsIndex != topsIndex2) {
                //                     let outs = [];
                //                     let overlapA = -1*Math.abs(up.tops[topsIndex].poly.areaDeep());
                //                     POLY.subtract([up.tops[topsIndex].poly], [up.tops[topsIndex2].poly], outs, null, up.z, min);
                //                     outs.forEach(function(outP) {
                //                         overlapA += Math.abs(outP.areaDeep());
                //                     });

                //                     if (Math.abs(overlapA) > 0.00001) {
                //                         console.log({overlapA_Before:overlapA});
                //                         // for (let justIterate = 0; justIterate < up.tops[topsIndex].poly.length; justIterate += 1) {
                //                         //     up.tops[topsIndex].poly.points[justIterate].X += 2000000;
                //                         //     up.tops[topsIndex].poly.points[justIterate].x += 20;
                //                         // }
                //                         // for (let justIterate = 0; justIterate < up.tops[topsIndex2].poly.length; justIterate += 1) {
                //                         //     up.tops[topsIndex2].poly.points[justIterate].X += 2000000;
                //                         //     up.tops[topsIndex2].poly.points[justIterate].x += 20;
                //                         // }
                //                         if (!up.tops[0].fill_sparse) up.tops[0].fill_sparse = [];
                //                         // up.tops[0].fill_sparse.push(up.tops[topsIndex].poly);
                //                         // up.tops[0].fill_sparse.push(up.tops[topsIndex2].poly);
                //                         if (!up.supports) up.supports = [];
                //                         // up.supports.push(up.tops[topsIndex].poly);
                //                         // up.supports.push(up.tops[topsIndex2].poly);
                //                         overlap_found = true;
                //                     }


                //                 }
                //             }
                //         }

                //     }
                //     if (overlap_found == false) {
                //         // up.tops = [];
                //     }
                // }


                // Clone and simplify tops
                up.topsSaved = up.tops.clone(true); // Clone tops
                for (let topsIndex = 0; topsIndex < up.topsSaved.length; topsIndex+=1) {
                    // The original top remains mostly intact, only the poly is changed
                    // Clone the poly
                    let originalPoly = up.tops[topsIndex].poly;
                    let inputPoly = originalPoly.clone(true);
                    up.topsSaved[topsIndex].poly = originalPoly; // Put original poly into cloned top.

                    // const perimeterLength = originalPoly.perim;
                    let outputPoly = adaptivePolySimplify(surrogate_settings.simplification_factor, surrogate_settings.simplification_factor+0.5, inputPoly, originalPoly.perim, originalPoly.area2, zed, mina, coff);

                    up.tops[topsIndex].poly = outputPoly;
                    // if (outputPoly.checkOut) {
                    // // if (true) {
                    //     console.log({Note:"Found Warning"});
                    //     if (!up.tops[0].fill_sparse) up.tops[0].fill_sparse = [];
                    //     up.tops[0].fill_sparse.push(outputPoly);
                    // }
                }

                // Removing polygons that are too small, breaking when using subtract and thus causing false positives during search
                if (up.tops) {
                    let newTops = [];
                    for (let topsIndex = 0; topsIndex < up.tops.length; topsIndex+=1) {
                        let primedPoly = []
                        POLY.subtract([up.tops[topsIndex].poly], [unreachable_poly], primedPoly, null, up.z, 0.05);
                        if (primedPoly.length == 1) {
                            if (Math.abs(primedPoly[0].area(true)) < 0.1) {
                                console.log({primedPoly:primedPoly});
                                console.log({inPoly:up.tops[topsIndex].poly});
                            }
                            // up.tops[topsIndex].poly = primedPoly[0];
                            newTops.push(up.tops[topsIndex]);
                            
                        }
                        // } else {    
                        //     console.log({WARNING:"Subtract with nothing changed number of polys"});
                        //     if (up.tops[topsIndex].poly.area2 > 0.01) console.log({WARNING:"AND area was not insignificant."});
                        //     console.log({inPoly:up.tops[topsIndex].poly});
                        //     console.log({primedPoly:primedPoly});
                        //     console.log({inArea2:up.tops[topsIndex].poly.area2});
                        //     if (primedPoly.length > 1) console.log({WARNING:"More than one out poly!!!!!"});
                        // }
                    }
                    up.tops = newTops;
                }


                // In case simplification led to overlaps
                if (up.tops) {
                    if (up.tops.length > 1) {
                        for (let topsIndex = 0; topsIndex < up.tops.length; topsIndex+=1) {
                            for (let topsIndex2 = 0; topsIndex2 < up.tops.length; topsIndex2+=1) {
                                if (topsIndex != topsIndex2) {
                                    let outs = [];
                                    let overlapA = -1*Math.abs(up.tops[topsIndex].poly.areaDeep());
                                    POLY.subtract([up.tops[topsIndex].poly], [up.tops[topsIndex2].poly], outs, null, up.z, 0.05);
                                    outs.forEach(function(outP) {
                                        overlapA += Math.abs(outP.areaDeep());
                                    });

                                    if (Math.abs(overlapA) > 0.00001)  {
                                        // console.log(up.tops[topsIndex].poly);
                                        // console.log(up.tops[topsIndex].poly.area2);
                                        // console.log(outs);
                                        if (outs && outs.length > 0) { // TODO Investigate how 0 can happen
                                            up.tops[topsIndex].poly = outs[0];
                                            up.tops[topsIndex].poly.area2 = up.tops[topsIndex].poly.area(true);
                                        }
                                        // console.log(up.tops[topsIndex].poly.area2);
                                        // console.log({overlapA_After:overlapA});
                                        // if (!up.tops[0].fill_sparse) up.tops[0].fill_sparse = [];
                                        //     // up.tops[0].fill_sparse.push(up.tops[topsIndex].poly);
                                        //     // up.tops[0].fill_sparse.push(up.tops[topsIndex2].poly);
                                        // if (!up.supports) up.supports = [];
                                        // // up.supports.push(up.tops[topsIndex].poly);
                                        // // up.supports.push(up.tops[topsIndex2].poly);
                                        // overlap_found2 = true;
                                    }
                                }
                            }
                        }
                    }
                }


                if (up.tops) {
                    if (up.tops.length > 1) {
                        let collDet = [];
                        POLY.subtract(up.topPolys(), [unreachable_poly], collDet, null, up.z, 0.05);
                        let post_collision_area = 0, pre_collision_area = 0;
                        up.topPolys().forEach(function(top_poly) {
                            pre_collision_area += Math.abs(top_poly.areaDeep());
                        });
                        collDet.forEach(function(top_poly) {
                            post_collision_area += Math.abs(top_poly.areaDeep());
                        });

                        const collision_area = pre_collision_area - post_collision_area;
                        if (collision_area > 0.00001) {
                            console.log({THISSLICE:up});
                            console.log({pre_collision_area:pre_collision_area});
                            console.log({post_collision_area:post_collision_area});
                            console.log({InPolys:up.topPolys()});
                            console.log({AfterNoSubtract:collDet});
                        }
                    }
                }

                // Get manual supports from other widget
                // if (otherWidget) { 
                //     if (otherWidget.slices) {
                //         if (otherWidget.slices.length >= up.index+1) {
                //             if (otherWidget.slices[up.index].tops) {
                //                 if (!up.supports) up.supports = [];
                //                 for (let otherSupportsInd = 0; otherSupportsInd < otherWidget.slices[up.index].tops.length; otherSupportsInd += 1) {
                //                     up.supports.push(otherWidget.slices[up.index].tops[otherSupportsInd].poly);
                //                 }
                //                 otherWidget.slices[up.index].tops = []; // Remove manual supports reference from other widget after moving them to this one
                //             }
                //         }
                //     }
                // }

                if (up.supports) {
                    let unionized_supports = POLY.union(up.supports, min, true);
                    // console.log({unionized_supports:unionized_supports});
                    
                    for (let supportsIndex = 0; supportsIndex < unionized_supports.length; supportsIndex+=1) {
                        unionized_supports[supportsIndex].perim = unionized_supports[supportsIndex].perimeter();
                    }
                    up.supports = unionized_supports;
                }

                // if (up.supports) {
                //     for (let supportsIndex = 0; supportsIndex < up.supports.length; supportsIndex+=1) {
                //         up.supports[supportsIndex].area2 = up.supports[supportsIndex].area(true);
                //     }
                // }

                up.supportsSaved = []; // Make array for cloned supports
                if (up.supports) {
                    for (let supportsIndex = 0; supportsIndex < up.supports.length; supportsIndex+=1) { // Save a copy, then simplify the supports
                        // Clone the poly
                        let originalPoly = up.supports[supportsIndex];
                        let inputPoly = originalPoly.clone(true);
                        inputPoly.area2 = originalPoly.area2;
                        up.supportsSaved.push(originalPoly);

                        // const perimeterLength = originalPoly.perim;
                        let outputPoly = adaptivePolySimplify(surrogate_settings.simplification_factor, surrogate_settings.simplification_factor, inputPoly, originalPoly.perim, originalPoly.area2, zed, mina, coff);

                        up.supports[supportsIndex] = outputPoly;
                        // console.log({outputPoly:outputPoly});
                        // if (outputPoly.checkOut) {
                        // // if (true) {
                        //     console.log({Hint:"Occured"});
                        //     if (!up.tops[0].fill_sparse) up.tops[0].fill_sparse = [];
                        //     up.tops[0].fill_sparse.push(outputPoly);
                        // }
                    }
                }

                // console.log({up:up});
            }

            all_slices.push(up);
            const stopAbove = up.z - surrogate_settings.min_squish_height;
            const skipBelow = up.z;
            surrogate_settings.precomputed_slice_heights.push({stopAbove:stopAbove, skipBelow:skipBelow});
            up = up.up;   
        }

        up = bottom_slice;

        let pre_surrogate_support_amounts = getTotalSupportVolume(bottom_slice);
        // console.log({pre_surrogate_support_amounts:pre_surrogate_support_amounts});

        surrogate_settings.total_surrogate_volume = pre_surrogate_support_amounts[0];
        surrogate_settings.total_surrogate_area = pre_surrogate_support_amounts[1];

        console.log({min_x:min_x});
        console.log({max_x:max_x});
        console.log({min_y:min_y});
        console.log({max_y:max_y});

        return [ all_slices, surrogate_settings ];
    }

    function doSurrogates(library_in, suse, slice, proc, shadow, settings, view, prisms) {
        if (true)
        {
            console.log({status:"Surrogates handling starts"});
        }

        let surros = library_in;
        let surrogate_settings = suse;

        var startTime = new Date().getTime();

        let minOffset = proc.sliceSupportOffset,
            maxBridge = proc.sliceSupportSpan || 5,
            minArea = proc.supportMinArea,
            pillarSize = proc.sliceSupportSize,
            offset = proc.sliceSupportOffset,
            gap = proc.sliceSupportGap,
            min = minArea || 0.01,
            size = (pillarSize || 1),
            mergeDist = size * 3, // pillar merge dist
            tops = slice.topPolys(),
            trimTo = tops,
            ctre = new ClipperLib.PolyTree();
        // create inner clip offset from tops
        //POLY.expand(tops, offset, slice.z, slice.offsets = []);

        let traces = POLY.flatten(slice.topShells().clone(true)),
            fill = slice.topFill(),
            points = [],
            down = slice.down,
            down_tops = down ? down.topPolys() : null,
            down_traces = down ? POLY.flatten(down.topShells().clone(true)) : null;

        let bottom_slice = slice.down;
        let last_bottom_slice;


        function getBestResult(optmizer_results) {
            let chosen_result;
            let highest_fitness = Number.NEGATIVE_INFINITY;
            let good_counter = 0;
            for (let result of optmizer_results) {
                if (result.valid) {
                    good_counter++;
                    if (result.fitness > highest_fitness) {
                        highest_fitness = result.fitness;
                        chosen_result = result;
                    }
                }
            }
            console.log({valid_PSO_combinations_found:good_counter});
            return chosen_result;
        }

        function getBestFittingSurrogateL2(surrogateList, desired_length, desired_width, desired_height) {
            let lowest_error = Infinity;
            let best_option = surrogateList[0];
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
                }
            }
            return best_option;
        }

        function getSurrogateGeometryAtIndexHeight(surrogate, z_height, index) {
            if (true) { // If surrogate is simple rectangular geometry
                if (z_height >= surrogate.starting_height && z_height <= surrogate.end_height) {
                    // let surrogate_larger = [];
                    // surrogate_larger = POLY.expand(surrogate.geometry, expansion_width, z_height, surrogate_larger, 1);
                    // return surrogate_larger;
                    return surrogate.geometry;
                }
                else return [];
            }
        }

        function getSurrogateReplacedVolumes(old_volume, new_volume, current_slice, surrogate_rectangle_list) {
            let supports_after_surrogates = [];
            POLY.subtract(current_slice.supports, surrogate_rectangle_list, supports_after_surrogates, null, current_slice.z, 0);

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

        // generate text polygon
        function generateAsciiPolygons(text, start_x, start_y, text_rotation, text_size) {
            function finishPoly(points) {
                let asciiPolygon = base.newPolygon(points);
                asciiPolygon.depth = 0;
                asciiPolygon.open = true;
                return asciiPolygon;
            }

            let singleAsciiPolyList = [];

            let rotation = text_rotation;
            let angular_rotation = rotation * Math.PI / 180;
            let distance_iterator = 0; 
            let combined_division_pos_counter = 0;
            let combined_division_list = [0];
            for (let char of text) {
                let char_int = char.charCodeAt(0);
                if (char_int == 32) {
                    distance_iterator += ascii_text_points[char_int][2]*1.25;
                    continue;
                }
                let char_pos = char_int-32;

                let ascii_location_array = ascii_text_points[char_pos][5];
                let division_pos_counter = 0;
                let division_list = [0];
                let temp_points = [];
                let scale_factor = text_size/20 * 0.3;
                

                
                // Collect all and rotate as combination
                for (let point_idx = 0; point_idx < ascii_location_array.length; point_idx = point_idx + 2) {
                    if (ascii_location_array[point_idx] == -1) {
                        division_list.push(division_pos_counter); // Start of next segment location
                        combined_division_list.push(combined_division_pos_counter); // Start of next word location
                    }
                    else {
                        let point_ascii = newPoint(scale_factor*(
                                                        ascii_location_array[point_idx] +  // X-location
                                                        ascii_text_points[char_pos][3] + // X-location adjustment
                                                        (distance_iterator)*Math.cos(angular_rotation)) + 
                                                    start_x, 

                                                    scale_factor*(
                                                        ascii_location_array[point_idx+1] + // Y-location
                                                        //ascii_text_points[char_pos][4] + // Y-location adjustment
                                                        (distance_iterator)*Math.sin(angular_rotation)) + 
                                                        
                                                    start_y, 

                                                    0);
                        let point_ascii2 = newPoint(scale_factor*(
                                                        ascii_location_array[point_idx] +  // X-location
                                                        ascii_text_points[char_pos][3] + // X-location adjustment
                                                        (distance_iterator)*1 ) + //Math.cos(angular_rotation)) + 
                                                    start_x, 

                                                    scale_factor*(
                                                        ascii_location_array[point_idx+1] + // Y-location
                                                        //ascii_text_points[char_pos][4] + // Y-location adjustment
                                                        0*(distance_iterator)*Math.sin(angular_rotation)) + 
                                                        
                                                    start_y, 

                                                    0);
                        temp_points.push(point_ascii);
                        singleAsciiPolyList.push(point_ascii2);
                        division_pos_counter++;
                        combined_division_pos_counter++;
                    }
                }
                division_list.push(division_pos_counter); 
                combined_division_list.push(combined_division_pos_counter); 

                // let non_oriented_poly = finishPoly(temp_points);
                // non_oriented_poly = non_oriented_poly.rotateXY(rotation);
                // console.log("...");
                // console.log({ascii_location_array:ascii_location_array});
                // console.log({division_list:division_list});

                // If there are smaller sub-polys, make them separate polys
                // if (division_list.length == 2) {
                //     asciiPolyList.push(non_oriented_poly);
                // } else {
                //     for (let division_idx = 0; division_idx < division_list.length-1; division_idx++){
                //         let yet_another_temp_point_list = [];
                //         for (let point_idx = division_list[division_idx]; point_idx < division_list[division_idx+1]; point_idx++) {
                //             yet_another_temp_point_list.push(non_oriented_poly.points[point_idx]);
                //         }
                //         asciiPolyList.push(finishPoly(yet_another_temp_point_list));
                //     }
                // }
                
                // let temp_point_list = [];
                // let pList = [];
                // let multiplePolys = false;
                // for (point of non_oriented_poly.points) {
                //     if (point.x == -1) {
                //         asciiPolyList.push(finishPoly(temp_point_list));
                //         multiplePolys = true;
                //     }
                //     else {
                //         temp_point_list.push(point);
                //     }
                // }
                // if (multiplePolys) {
                //     let finalAsciiPolygon = base.newPolygon(temp_point_list);
                //     pList.push(finalAsciiPolygon);
                // } else {

                // }


                // asciiPolyList.push(finishPoly(temp_points, rotation));
                // let finishedPolys = finishPoly(temp_points, rotation);
                // for (finishedPoly of finishedPolys) {
                //     asciiPolyList.push(finishedPoly);
                // }
                // temp_points = [];

                // counter++;
                distance_iterator += ascii_text_points[char_pos][2]*1.25;
            }

            let singleAsciiPoly = finishPoly(singleAsciiPolyList);
            let midpoint = newPoint(start_x, start_y, 0);
            let inverse_midpoint_vector = newPoint(0-start_x, 0-start_y, 0);
    
            let translation_poly_copyx = singleAsciiPoly.points.clone();
            singleAsciiPoly.points = singleAsciiPoly.translatePoints(translation_poly_copyx, inverse_midpoint_vector);
            
            singleAsciiPoly = singleAsciiPoly.rotateXYsimple(rotation);

            let translation_poly_copy2x = singleAsciiPoly.points.clone();
            singleAsciiPoly.points = singleAsciiPoly.translatePoints(translation_poly_copy2x, midpoint);

            let combinedAsciiPolyList = [];

            for (let division_idx = 0; division_idx < combined_division_list.length-1; division_idx++){
                let yet_another_temp_point_list = [];
                for (let point_idx = combined_division_list[division_idx]; point_idx < combined_division_list[division_idx+1]; point_idx++) {
                    yet_another_temp_point_list.push(singleAsciiPoly.points[point_idx]);
                }
                combinedAsciiPolyList.push(finishPoly(yet_another_temp_point_list));
            }


            // console.log({asciiPolyList:asciiPolyList});
            // return asciiPolyList;
            // return [singleAsciiPoly];
            return combinedAsciiPolyList;
        }

        // Function to translate adding pause layers into a string for the UI (and the export parser)
        function addPauseLayer(insertion_layer_index, settings, surrogate_settings) {
            if (settings.process.gcodePauseLayers == null) settings.process.gcodePauseLayers = "";
            if (settings.process.gcodePauseLayers != "") settings.process.gcodePauseLayers += ",";
            settings.process.gcodePauseLayers += insertion_layer_index.toString();
            console.log({pauselayer:insertion_layer_index});
            console.log({pause_layers:settings.process.gcodePauseLayers});
            surrogate_settings.pauseLayers.push(insertion_layer_index);
            surrogate_settings.pauseLayers.sort(function(a, b) {
                return a - b;
            });
            console.log({pauseLayers:surrogate_settings.pauseLayers});
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

        function checkVolumeAndCollisionsList(stopEarly, surrogate_library, surrogate_settings, all_slices, sliceIndexList, try_surro_index, try_surro_polygons_list, surrogates_placed) {
            let collision = false;
            let overextended = false;

            let try_surro = surrogate_library[try_surro_index];
            let new_volume = 0;
            let old_volume = 0;

            let last_collision_area = 0;
            let max_surrogated_area = 0;

            let check_collisions = true;
            // TODO: Make try_surro_polygons_list here, or generate only once and translate+rotate instead

            for (let indexIndex = 0; indexIndex < sliceIndexList.length; indexIndex++) {
                let current_slice = all_slices[sliceIndexList[indexIndex]];
            
                // DON'T skip the layers, since we are looking for model polygons and previous surrogate supports
                // Skip layers without support
                // if (!current_slice.supports || current_slice.supports.length === 0) {
                //     current_slice = current_slice.up;
                //     console.log({going_up: "No support to check for collision found on this slice"});
                //     continue;
                // }

                let calculating_volume = true;
                
                // let slice_height_range = get_height_range(current_slice);

                // Skip volume count for layers that have no supports
                if (!current_slice.supports || current_slice.supports.length === 0) {
                    calculating_volume = false;
                }

                // TODO: Remove if unnecessary
                if (collision) check_collisions = false;
                
                if (calculating_volume) {
                    const volumes = getSurrogateReplacedVolumes(old_volume, new_volume, current_slice, try_surro_polygons_list);
                    old_volume = volumes[0];
                    new_volume = volumes[1];
                    if (max_surrogated_area < volumes[2]) max_surrogated_area = volumes[2];
                }

                if (check_collisions) {
                    // console.log(current_slice.index);
                    let collision_detection = [];
                    POLY.subtract(current_slice.topPolys(), try_surro_polygons_list, collision_detection, null, current_slice.z, min);
                    // console.log({try_surro_polygons_list:try_surro_polygons_list});
                    
                    let post_collision_area = 0, pre_collision_area = 0;
                    current_slice.topPolys().forEach(function(top_poly) {
                        pre_collision_area += Math.abs(top_poly.areaDeep());
                    });
                    collision_detection.forEach(function(top_poly) {
                        post_collision_area += Math.abs(top_poly.areaDeep());
                    });
                    
                    if ((pre_collision_area - post_collision_area) > 0.00001) { // rounded the same // TODO: Currently testing whether we need Math abs with switched subtraction order
                        // if ((slice_height_range.bottom_height + surrogate_settings.min_squish_height) < (try_surro.minHeight + try_z)) {
                        if ((current_slice.z - surrogate_settings.min_squish_height) < (try_surro.minHeight + try_z)) {
                            collision = true;
                            last_collision_area = pre_collision_area - post_collision_area;
                            continue;
                        }
                        else {
                            try_surro.height = current_slice.down.z; // TODO: Test whether this is the best previous height
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
                            if (current_slice.z <= (previous_surrogate.end_height) && current_slice.z >= previous_surrogate.starting_height) {

                                collision_detection = [];
                                
                                POLY.subtract(try_surro_polygons_list, previous_surrogate.geometry, collision_detection, null, current_slice.z, min); // TODO: Check if Z matters
                                
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
                                    if ((current_slice.z - surrogate_settings.min_squish_height) < (try_surro.minHeight + try_z)) {
                                        collision = true;
                                        last_collision_area = pre_collision_area - post_collision_area;
                                        continue;
                                    }
                                    else {
                                        try_surro.height = current_slice.down.z; // TODO: Test whether this is the best previous height
                                        overextended = true;
                                        continue;
                                    }
                                    //console.log({collision_true: post_collision_area - pre_collision_area});
                                }
                            }
                        }
                    }
                }

                // insertion_layer_number_guess = current_slice.index;
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

        // function placeAndEval(var_and_settings) {
        //     let all_surrogates = [];
        //     for (old_surrogate of var_and_settings[1].existing_surrogates) {
        //         all_surrogates.push(old_surrogate);
        //     };
        //     let new_surrogates = [];
        //     let results_array = [];

        //     // let pso_collision_and_volumes = checkVolumeAndCollisions(surros, optimizer.surrogate_settings, bottom_slice, try_surro_index, try_surro_polygons_list, try_z, surrogates_placed);

        //     for (let iteration_number = 0; iteration_number < var_and_settings[1].searchspace_max_number_of_surrogates; iteration_number++) {

        //         // if (var_list[0] >= iteration_number) {
        //         if(true) {

        //             // Select test surrogate
        //             let library_index = Math.floor(var_and_settings[0][iteration_number*var_and_settings[1].number_of_vars + 5]);
        //             if (library_index >= var_and_settings[2].length) {
        //                 library_index = var_and_settings[2].length-1;
        //             }
        //             else if (library_index < 0) {
        //                 library_index = 0;
        //             }
        //             let pso_surrogate = var_and_settings[2][library_index];

        //             // Select test tower position/on baseplate
        //             let pso_z = 0;
        //             let tower_library_index = 0;
        //             if (var_and_settings[0][iteration_number*var_and_settings[1].number_of_vars + 3] >= 1) {
        //                 tower_library_index = 0.99999;
        //             }
        //             else if (var_and_settings[0][iteration_number*var_and_settings[1].number_of_vars + 3] < 0) {
        //                 tower_library_index = 0;
        //             }
        //             else tower_library_index = var_and_settings[0][iteration_number*var_and_settings[1].number_of_vars + 3];
        //             tower_library_index = Math.floor(tower_library_index * (all_surrogates.length+1)); // #previous surrogates + 1 for on-baseplate
        //             tower_library_index = tower_library_index - 1; 
        //             if (tower_library_index > 0) pso_z = all_surrogates[tower_library_index].starting_height + all_surrogates[tower_library_index].surro.height;
                    

                    
        //             // generate polygons // TODO: Is it faster to make one poly for the surrogate and then rotate+translate /modify the points directly?
        //             let pso_polygons_list = []
        //             if (pso_surrogate.type == "simpleRectangle") {
        //                 pso_polygons_list = [generateRectanglePolygonCentered(var_and_settings[0][iteration_number*var_and_settings[1].number_of_vars + 1], var_and_settings[0][iteration_number*var_and_settings[1].number_of_vars + 2], var_and_settings[1].start_slice.z, pso_surrogate.length, pso_surrogate.width, var_and_settings[0][iteration_number*var_and_settings[1].number_of_vars + 4], surrogate_settings.surrogate_padding, var_and_settings[1].start_slice)];
        //             }
        //             else if (pso_surrogate.type == "prism") {
        //                 pso_polygons_list = [generatePrismPolygon(var_and_settings[0][iteration_number*var_and_settings[1].number_of_vars + 1], var_and_settings[0][iteration_number*var_and_settings[1].number_of_vars + 2], var_and_settings[1].start_slice.z, pso_surrogate.prism_geometry, var_and_settings[0][iteration_number*var_and_settings[1].number_of_vars + 4], surrogate_settings.surrogate_padding, var_and_settings[1].start_slice)];
        //             }


        //             // Out of build-area check
        //             for (let pso_poly of pso_polygons_list) {
        //                 // translate widget coordinate system to build plate coordinate system and compare with build plate size (center is at 0|0, bottom left is at -Width/2<|-Depth/2)
        //                 if (pso_poly.bounds.maxx + shift_x > bedWidthArea || pso_poly.bounds.minx + shift_x < -bedWidthArea || pso_poly.bounds.maxy + shift_y > bedDepthArea || pso_poly.bounds.miny + shift_y < -bedDepthArea || pso_z + pso_surrogate.height > settings.device.bedDepth) {
        //                     continue; // TODO: save for return later the negative size of overlap for this test part?
        //                 }
        //             }

        //             // Stability check
        //             if (tower_library_index >= 0) {
        //                 let unsupported_polygons = [];
        //                 let unsupp_area = 0, full_area = 0;
        //                 POLY.subtract(pso_polygons_list, all_surrogates[tower_library_index].geometry, unsupported_polygons, null, var_and_settings[1].start_slice.z, min);
        //                 unsupported_polygons.forEach(function(unsupp) {
        //                     unsupp_area += Math.abs(unsupp.areaDeep());
        //                 });
        //                 pso_polygons_list.forEach(function(full) {
        //                     full_area += Math.abs(full.areaDeep());
        //                 });

        //                 // If less than half the area of the new surro is supported by the surro below, surrogate is unstable
        //                 //if ((unsupp_area * 2) > full_area) {
        //                 // For now, use 100% support instead
        //                 if (unsupp_area > 0) {
                            
        //                     continue;
        //                 }
        //             }

        //             let pso_collision_and_volumes = checkVolumeAndCollisions(var_and_settings[2], var_and_settings[1], var_and_settings[1].start_slice, library_index, pso_polygons_list, pso_z, all_surrogates);
        //             const delta_volume = pso_collision_and_volumes[1] - pso_collision_and_volumes[2];
        //             if (delta_volume > 0) {
        //                 results_array.push(pso_collision_and_volumes);
        //                 // console.log({pso_collision_and_volumes:pso_collision_and_volumes});
        //                 if (pso_collision_and_volumes[0] === false) var_and_settings[0][iteration_number*var_and_settings[1].number_of_vars + 7] = 1;
        //                 else var_and_settings[0][iteration_number*var_and_settings[1].number_of_vars + 7] = 0;

        //                 if (pso_collision_and_volumes[0] === false) { // No collision
        //                     // save successful candidate // TODO: (and validation insertion case and layer)
        //                     let lower_surrogate = [];
        //                     let empty_array = [];
        //                     let data_array = {insertion_case:"unknown"};
        //                     if (stack_on_surro_index >= 0) {
        //                         lower_surrogate.push(all_surrogates[tower_library_index]);
        //                     }
        //                     let end_height = pso_z + pso_surrogate.height;
        //                     let candidate = {
        //                         geometry:pso_polygons_list, 
        //                         surro:pso_surrogate, starting_height:pso_z, 
        //                         end_height:end_height, 
        //                         down_surrogate:lower_surrogate, 
        //                         up_surrogate:empty_array, 
        //                         outlines_drawn:0, 
        //                         insertion_data:data_array
        //                     };

        //                     check_surrogate_insertion_case(candidate, var_and_settings[1].start_slice, var_and_settings[1]);

        //                     all_surrogates.push(candidate);
        //                     new_surrogates.push(candidate);



        //                 } else {
                            
        //                 }
        //             }
        //         }
        //     }

        //     let valid_combination = true;
        //     // let total_surrogates_volume = var_and_settings[1].fitness_offset;
        //     let total_surrogates_volume = 0;
        //     let total_collided_surrogates_volume = 0;
        //     let interaction_layer_set = new Set();
        //     let collision_area_estimate = 0;
        //     let surrogate_area_estimate = 0;
        //     const number_of_surrogates = all_surrogates.length;


        //     for (const result of results_array) {
        //         if (result[0] === true) { // Collided surrogates
        //             valid_combination = false;
        //             const delta_volume = result[1] - result[2];
        //             total_collided_surrogates_volume += delta_volume;
        //             collision_area_estimate += result[3]; // Get overlap area estimate
        //             surrogate_area_estimate += result[4];
        //         }
        //         else { // Good surrogates
        //             const delta_volume = result[1] - result[2];
        //             total_surrogates_volume += delta_volume; // Get surrogated volume
        //         }
                
                

        //         // let delta_volume = result[1] - result[2] + var_and_settings[1].fitness_offset;

        //     }

        //     for (const surrogate of all_surrogates) {
        //         interaction_layer_set.add(surrogate.insertion_data.new_layer_index) // Get number of interaction layers // TODO: add extra interactions as penalty for difficult surrogates (bridges, stacks...)
        //     }

        //     const number_of_interactions = interaction_layer_set.size;
        //     let fitness = 0;

        //     if (total_surrogates_volume > 0) {
        //         // console.log({interaction_layer_set:interaction_layer_set});
        //         // console.log({all_surrogates:all_surrogates});
        //         const w_pieces = 0.3;
        //         const w_interactions = 0.7;
        //         const surrogate_N_penalty_factor = 0;//0.8;
        //         const interaction_N_penalty_factor = 0;//0.35;


        //         // console.log({total_surrogates_volume:total_surrogates_volume});
        //         fitness = total_surrogates_volume / (w_pieces * Math.pow(number_of_surrogates, surrogate_N_penalty_factor) + w_interactions * Math.pow(number_of_interactions, interaction_N_penalty_factor));
        //     }
            
        //     if (valid_combination) console.log({valid_combination:valid_combination});
            
        //     if (valid_combination === false && total_collided_surrogates_volume > 0) {
        //         let overlap_factor = (collision_area_estimate / surrogate_area_estimate);
        //         if (overlap_factor > 1) overlap_factor = 1.0;
        //         // console.log({overlap_factor:pso_collision_and_volumes[3]});
        //         // if (fitness > var_and_settings[1].best_valid) fitness = var_and_settings[1].best_valid;
        //         total_collided_surrogates_volume = total_collided_surrogates_volume * (1.0-overlap_factor); // Reduce by overlap percentage
        //         if (var_and_settings[1].leniency >= 0) {
        //             if (Math.random() >= var_and_settings[1].leniency) {
        //                 // delta_volume = delta_volume * var_and_settings[1].leniency;
        //                 fitness = fitness + (total_collided_surrogates_volume)*0.01
        //                 // console.log({fitness:fitness});
        //                 return fitness; 
        //             }
        //             else {
        //                 fitness = fitness + (total_collided_surrogates_volume)*0.01
        //                 // console.log({fitness:fitness});
        //                 return fitness;
        //             }
        //             // delta_volume = delta_volume * var_and_settings[1].leniency;
        //             // return delta_volume;
        //         }
        //         else {
        //             // Doesn't happen yet. Restore negative numbers that describe overlap area
        //             console.log({error:"Objective function: Should not have reached this"});
        //         }
        //     } else {
        //         // console.log({fitness:fitness});
        //         return fitness; 
        //     }
        // }

        function adaptivePolySimplify(flatFactor, logFactor, poly, perimeterLength, prevArea2, zed, mina, coff) {
            const averageLineLength = perimeterLength / poly.length;
            // const LengthPerArea = Math.abs(poly.area2)/averageLineLength;)
            let checkOut = false;

            if (averageLineLength < 2.0 && poly.length > 10) {
                coff = new ClipperLib.ClipperOffset();
                const simplification_factor = 2182.24*flatFactor * Math.log(16.1379*logFactor * averageLineLength);
                let inputPolyClipped = poly.toClipper();
                inputPolyClipped = ClipperLib.Clipper.CleanPolygons(inputPolyClipped, simplification_factor);
                // inputPolyClipped= ClipperLib.Clipper.SimplifyPolygons(inputPolyClipped, 1);

                // const newLength = inputPolyClipped[0].length;
                // const newALL = perimeterLength / newLength;
                // if (newLength > 100 || newLength < 4 || newALL > 6 || newALL < 1.0) {
                //     console.log({WARNING:"Check simplification result"});
                //     console.log({poly:poly});
                //     console.log({inputPolyClipped:inputPolyClipped});
                //     console.log({newALL:newALL});
                //     console.log({oldAll:averageLineLength});
                //     console.log({perimeterLength:perimeterLength});
                //     console.log({inputPolyClippedLength:newLength});
                //     checkOut = true;
                // }

                // if (inputPolyClipped.length > 0) {
                //     for (let justIterate = 0; justIterate < inputPolyClipped[0].length; justIterate += 1) {
                //         inputPolyClipped[0][justIterate].Y += 1000000;
                //     }
                // }

                coff.AddPaths(inputPolyClipped, 2, 4);
                coff.Execute(ctre, 0);
                let outputPolys = POLY.fromClipperTree(ctre, zed, null, null, mina);

                

                if (outputPolys.length > 0) {
                    outputPolys[0].area2 = outputPolys[0].area(true);
                    // if (Math.abs(Math.abs(outputPolys[0].area2) - Math.abs(prevArea2) > 5)) {
                    //     console.log({WARNING:"Area after simplifying top polygon changed a lot."});
                    //     console.log("Simplified_area: " + outputPolys[0].area2.toString());
                    //     console.log("Original_area: " + prevArea2.toString());
                    //     checkOut = true;
                    //     for (let justIterate = 0; justIterate < outputPolys[0].points.length; justIterate += 1) {
                    //         outputPolys[0].points[justIterate].Y += 10000000;
                    //         outputPolys[0].points[justIterate].y += 100;
                    //     }
                    // }
                    if (outputPolys.length > 1) {
                        // console.log({WARNING:"More than one output poly after simplification."});
                        // console.log({outputPolys:outputPolys});
                        checkOut = true;
                        
                        outputPolys[0].points.push(...outputPolys[1].points); // TODO: Handle this more cleanly
                        // for (let justIterate = 0; justIterate < outputPolys[0].points.length; justIterate += 1) {
                        //     outputPolys[0].points[justIterate].Y += 10000000;
                        //     outputPolys[0].points[justIterate].y += 100;
                        // }
                    }
                    outputPolys[0].checkOut = checkOut;
                    return outputPolys[0];
                }
                else {

                    // for (let justIterate = 0; justIterate < poly.length; justIterate += 1) {
                    //     poly.points[justIterate].Y += 600000;
                    //     poly.points[justIterate].y += 6;
                    // }
                    // console.log({WARNING:"Clipper returned empty polygon"});
                    // console.log({outputPolys:outputPolys});
                    // console.log({poly:poly});
                    // console.log({inputPolyClipped:inputPolyClipped});
                    // console.log({oldAll:averageLineLength});
                    checkOut = true;
                    poly.checkOut = checkOut;
                    return poly;
                }
            }
            else {
                poly.perim = perimeterLength;
                poly.area2 = prevArea2;
                poly.checkOut = checkOut;
                return poly;
            }
        }

        function adaptivePolySimplifyList(flatFactor, logFactor, poly, perimeterLength, prevArea2, zed, mina, coff) {
            const averageLineLength = perimeterLength / poly.length;
            // const LengthPerArea = Math.abs(poly.area2)/averageLineLength;)
            let checkOut = false;

            if (averageLineLength < 2.0 && poly.length > 10) {
                coff = new ClipperLib.ClipperOffset();
                const simplification_factor = 2182.24*flatFactor * Math.log(16.1379*logFactor * averageLineLength);
                let inputPolyClipped = poly.toClipper();
                inputPolyClipped = ClipperLib.Clipper.CleanPolygons(inputPolyClipped, simplification_factor);
                // inputPolyClipped= ClipperLib.Clipper.SimplifyPolygons(inputPolyClipped, 1);

                // const newLength = inputPolyClipped[0].length;
                // const newALL = perimeterLength / newLength;
                // if (newLength > 100 || newLength < 4 || newALL > 6 || newALL < 1.0) {
                //     console.log({WARNING:"Check simplification result"});
                //     console.log({poly:poly});
                //     console.log({inputPolyClipped:inputPolyClipped});
                //     console.log({newALL:newALL});
                //     console.log({oldAll:averageLineLength});
                //     console.log({perimeterLength:perimeterLength});
                //     console.log({inputPolyClippedLength:newLength});
                //     checkOut = true;
                // }

                // if (inputPolyClipped.length > 0) {
                //     for (let justIterate = 0; justIterate < inputPolyClipped[0].length; justIterate += 1) {
                //         inputPolyClipped[0][justIterate].Y += 1000000;
                //     }
                // }

                coff.AddPaths(inputPolyClipped, 2, 4);
                coff.Execute(ctre, 0);
                let outputPolys = POLY.fromClipperTree(ctre, zed, null, null, mina);

                

                if (outputPolys.length > 0) {
                    outputPolys[0].area2 = outputPolys[0].area(true);
                    if (Math.abs(Math.abs(outputPolys[0].area2) - Math.abs(prevArea2) > 5)) {
                        console.log({WARNING:"Area after simplifying top polygon changed a lot."});
                        console.log("Simplified_area: " + outputPolys[0].area2.toString());
                        console.log("Original_area: " + prevArea2.toString());
                    }
                    if (outputPolys.length > 1) {
                        console.log({WARNING:"More than one output poly after simplification."});
                        console.log({outputPolys:outputPolys});
                        checkOut = true;
                        
                        outputPolys[0].points.push(...outputPolys[1].points);


                        for (let justIterate = 0; justIterate < outputPolys[0].points.length; justIterate += 1) {
                            outputPolys[0].points[justIterate].Y += 2000000;
                            outputPolys[0].points[justIterate].y += 20;
                        }
                    }
                    outputPolys[0].checkOut = checkOut;
                    return outputPolys[0];
                }
                else {

                    // for (let justIterate = 0; justIterate < poly.length; justIterate += 1) {
                    //     poly.points[justIterate].Y += 600000;
                    //     poly.points[justIterate].y += 6;
                    // }
                    console.log({WARNING:"Clipper returned empty polygon"});
                    console.log({outputPolys:outputPolys});
                    console.log({poly:poly});
                    console.log({inputPolyClipped:inputPolyClipped});
                    console.log({oldAll:averageLineLength});
                    checkOut = true;
                    poly.checkOut = checkOut;
                    return poly;
                }
            }
            else {
                poly.perim = perimeterLength;
                poly.area2 = prevArea2;
                poly.checkOut = checkOut;
                return poly;
            }
        }



        let depth = 0;

        while (down) {
            down = down.down;
            depth++;
        }
        //console.log({support_area: support_area});

  
        // let test_surro_rectangle_list = [generateRectanglePolygonCentered(0, -20, slice.z, 5, 30, 0.0)];
        // test_surro_rectangle_list.push(generateRectanglePolygonCentered(0, 10, slice.z, 2, 2, 0));
        // test_surro_rectangle_list.push(generateRectanglePolygonCentered(0, 15, slice.z, 2, 2, 0));
        // test_surro_rectangle_list.push(generateRectanglePolygonCentered(0, 20, slice.z, 2, 2, 0));
        let test_surro_rectangle_list = [];
        let support_area = 0;
        let otherWidget;
        

        while (bottom_slice) {
            last_bottom_slice = bottom_slice;
            bottom_slice = bottom_slice.down;
            if (!otherWidget) { // The second widget has the manual support pillars 
                try {
                    const thisWidgetID = bottom_slice.widget.id;
                    for (let widInd = 0; widInd < bottom_slice.widget.group.length; widInd +=1 ) {
                        if (bottom_slice.widget.group[widInd].id != thisWidgetID)  {
                            otherWidget = bottom_slice.widget.group[widInd]; // Get widget with manual supports
                            break;
                        }
                    }
                }
                catch { } // We don't care if there is none
            }
        }

        bottom_slice = last_bottom_slice;
        console.log({bottom_slice: bottom_slice});



        let up = bottom_slice, up_collision_check = bottom_slice;

        // const offset = 0.4;
        // const miter = 2 / offset;

        // let coff = new ClipperLib.ClipperOffset(opts.miter, opts.arc);
        let coffTest = new ClipperLib.ClipperOffset(undefined, undefined);

        if (!bottom_slice.tops[0].fill_sparse) bottom_slice.tops[0].fill_sparse = [];

        // let densePoly = bottom_slice.tops[0].poly;
        // let densePoly = bottom_slice.supports[0];

        // // console.log({densePoly:densePoly});
        // densePoly = densePoly.toClipper();
        // // console.log({densePolyClipper:densePoly});
        // let polyClean = ClipperLib.Clipper.CleanPolygons(densePoly, 3000);
        // // console.log({polyClean:polyClean});
        // let polySimple = ClipperLib.Clipper.SimplifyPolygons(polyClean, 1);
        // // console.log({polySimple:polySimple});

        // for (let justIterate = 0; justIterate < polySimple[0].length; justIterate += 1) {
        //     polySimple[0][justIterate].X += 6000000;
        //     polySimple[0][justIterate].Y += 6000000;
        // }

        // console.log({polySimple:polySimple});


        // // var path = ClipperLib.Clipper.TranslatePath(polySimple, {X:60,Y:0,Z:0});
        // coff.AddPaths(polySimple, 2, 4);
        // // coff.AddPaths(path, 2, 4);
        // // coff.Execute(ctre, offset * CONF.clipper);
        // coff.Execute(ctre, 0 * CONF.clipper);

        // let mina = min; //numOrDefault(min, 0.1);
        // let zed = bottom_slice.z || 0;

        // let densePolyS = POLY.fromClipperTree(ctre, zed, null, null, mina);

        // // console.log({densePolyS:densePolyS});

        // coff = new ClipperLib.ClipperOffset(undefined, undefined);
        // let densePoly2 = bottom_slice.tops[0].poly;
        // densePoly2 = densePoly2.toClipper();
        // let polyClean2 = ClipperLib.Clipper.CleanPolygons(densePoly2, 3000);
        // // let polySimple2= ClipperLib.Clipper.SimplifyPolygons(polyClean2, 1);
        // coff.AddPaths(polyClean2, 2, 4);
        // coff.Execute(ctre, 0 * CONF.clipper);
        // let densePolyS2 = POLY.fromClipperTree(ctre, zed, null, null, mina);
        // // console.log({densePolyS2:densePolyS2});





        
        

        // bottom_slice.tops[0].fill_sparse.push(densePolyS[0]);
        // // bottom_slice.tops[0].poly = densePolyS[0];


        bottom_slice.efficiencyData = {numberPauses:0, numberSurrogates:0, materialWeightEstimateTube: 0, materialWeightEstimateBar: 0, materialWeightEstimateEllipse: 0, timestamp:0, id:0, previous_volume:0, new_volume:0, volume_percentage_saved:0};


        // let inputPoly = bottom_slice.tops[0].poly;
        // const perimeterLength = inputPoly.perim;
        // const averageLineLength = perimeterLength / inputPoly.length;
        // let coun = 0;
        // for (let testIter = 10; testIter < 100; testIter += 10) {
        //     let simplification_factor = testIter*100;
        //     coun += 1;


        //     coffTest = new ClipperLib.ClipperOffset(undefined, undefined);
        //     let inputPoly = bottom_slice.tops[0].poly;
        //     const perimeterLength = inputPoly.perim;
        //     const averageLineLength = perimeterLength / inputPoly.length;
        //     const LengthPerArea = Math.abs(inputPoly.area2)/averageLineLength;
        //     let inputPolyClipped = inputPoly.toClipper();
        //     inputPolyClipped = ClipperLib.Clipper.CleanPolygons(inputPolyClipped, simplification_factor);
        //     // inputPolyClipped= ClipperLib.Clipper.SimplifyPolygons(inputPolyClipped, 1);

        //     for (let justIterate = 0; justIterate < inputPolyClipped[0].length; justIterate += 1) {
        //         inputPolyClipped[0][justIterate].X += coun*4000000;
        //         // inputPolyClipped[0][justIterate].Y += 6000000;
        //     }
        //     console.log({inputPolyClipped:inputPolyClipped});
        //     coffTest.AddPaths(inputPolyClipped, 2, 4);
        //     coffTest.Execute(ctre, 0 * CONF.clipper);
        //     let outputPoly = POLY.fromClipperTree(ctre, 0.125, null, null, 0.1);
        //     console.log({outputPoly:outputPoly});
        //     if (outputPoly[0]) {
        //         const averageLineLengthResult = perimeterLength / outputPoly[0].length;
        //         const LengthPerAreaResult = Math.abs(outputPoly[0].area2)/averageLineLengthResult;
        //         bottom_slice.tops[0].fill_sparse.push(outputPoly[0]);

        //         console.log("Factor: " + simplification_factor.toString() + "= In-Density: " + averageLineLength.toString() + ", In-Number: " + inputPoly.length.toString() + " --- " + "Out-Density: " + averageLineLengthResult.toString() + ", Out-Number: " + outputPoly[0].length.toString());
        //     }
        //     else {
        //         console.log("Factor: " + simplification_factor.toString() + "= Destroyed poly");
        //     }

        // }




        // let surrogate_settings = {};

        let searchType = "PSO";
        let surrogate_number_goal;

        if (proc.surrogateInteraction == "off") {
            surrogate_number_goal = 0;
            surrogate_settings.minVolume = 100;
            surrogate_settings.interaction_N_penalty_factor = 0.9;
            surrogate_settings.surrogate_N_penalty_factor = 0.9;
            surrogate_settings.searchspace_min_number_of_surrogates = 0;
        } else if(proc.surrogateInteraction == "low") {
            surrogate_number_goal = 4;
            surrogate_settings.minVolume = 100;
            surrogate_settings.interaction_N_penalty_factor = 0.35;
            surrogate_settings.surrogate_N_penalty_factor = 0.8;
            surrogate_settings.searchspace_min_number_of_surrogates = 2;
        } else if(proc.surrogateInteraction == "medium") {
            surrogate_number_goal = 5;
            surrogate_settings.minVolume = 50;
            surrogate_settings.interaction_N_penalty_factor = 0.3;
            surrogate_settings.surrogate_N_penalty_factor = 0.65;
            surrogate_settings.searchspace_min_number_of_surrogates = 3;
        } else if(proc.surrogateInteraction == "high") {
            surrogate_number_goal = 7;
            surrogate_settings.minVolume = 10;
            surrogate_settings.interaction_N_penalty_factor = 0.0;
            surrogate_settings.surrogate_N_penalty_factor = 0.0;
            surrogate_settings.searchspace_min_number_of_surrogates = 5;
        }

        if (proc.surrogateSearchQual == "fastest") {
            surrogate_settings.exploration_factor = 0.3;
            surrogate_settings.simplification_factor = 4.0;
            surrogate_settings.search_persistance = 4;
            surrogate_settings.minImprovementPercentage = 0.08;
            surrogate_settings.numberOfParticles = 10; // 175
            surrogate_settings.searchspace_max_number_of_surrogates = 4;
            
        } else if(proc.surrogateSearchQual == "fair") {
            surrogate_settings.exploration_factor = 0.2;
            surrogate_settings.simplification_factor = 3.5;
            surrogate_settings.search_persistance = 5;
            surrogate_settings.minImprovementPercentage = 0.04;
            surrogate_settings.numberOfParticles = 15;
            surrogate_settings.searchspace_max_number_of_surrogates = 5;

        } else if(proc.surrogateSearchQual == "good") {
            surrogate_settings.exploration_factor = 0.12;
            surrogate_settings.simplification_factor = 3;
            surrogate_settings.search_persistance = 5;
            surrogate_settings.minImprovementPercentage = 0.015;
            surrogate_settings.numberOfParticles = 20;
            surrogate_settings.searchspace_max_number_of_surrogates = 6;

        } else if(proc.surrogateSearchQual == "best") {
            surrogate_settings.exploration_factor = 0.0;
            surrogate_settings.simplification_factor = 2.5;
            surrogate_settings.search_persistance = 8;
            surrogate_settings.minImprovementPercentage = 0.01;
            surrogate_settings.numberOfParticles = 30;//275;
            surrogate_settings.searchspace_max_number_of_surrogates = 7;
        }

        console.log({surrogateSearchQual:proc.surrogateSearchQual});
        console.log({surrogateInteraction:proc.surrogateInteraction});


        let search_padding = 50; // TODO: Adjust to size of surrogate/largest surrogate?
        // Search bounds
        const min_x = bottom_slice.widget.bounds.min.x - search_padding;
        const max_x = bottom_slice.widget.bounds.max.x + search_padding;
        const min_y = bottom_slice.widget.bounds.min.y - search_padding;
        const max_y = bottom_slice.widget.bounds.max.y + search_padding;
        const bedDepthArea = settings.device.bedDepth / 2;
        const bedWidthArea = settings.device.bedWidth / 2;
        const shift_x = bottom_slice.widget.track.pos.x;
        const shift_y = bottom_slice.widget.track.pos.y;

        console.log({bedDepthArea:bedDepthArea});
        console.log({bedWidthArea:bedWidthArea});

        console.log({shift_x:shift_x});
        console.log({shift_y:shift_y});
        
        let repetition_goal = 10000;
        let surrogates_placed = [];
        let try_x = 0;
        let try_y = 0;
        let try_z = 0;
        let try_rotation = 0;
        let try_surro = 0;
        let try_surro_index = 0;
        let rotations = [0,45,90,135,180,225,270,315];
        let layer_height_fudge = settings.process.sliceHeight/1.75;
        let print_on_surrogate_extra_height_for_extrusion = 0;
        surrogate_settings.surrogate_padding = 0.1;
        surrogate_settings.min_squish_height = settings.process.sliceHeight/4;
        surrogate_settings.max_extra_droop_height = settings.process.sliceHeight/4;
        surrogate_settings.minimum_clearance_height = settings.process.sliceHeight/4;
        surrogate_settings.rotations = rotations;
        surrogate_settings.print_on_surrogate_extra_height_for_extrusion = print_on_surrogate_extra_height_for_extrusion;
        surrogate_settings.layer_height_fudge = layer_height_fudge;
        surrogate_settings.start_slice = bottom_slice;
        surrogate_settings.existing_surrogates = [];
        surrogate_settings.number_of_vars = 7; // Number of variables per surrogate PSO test
        surrogate_settings.average_so_far = 0;

        surrogate_settings.fitness_offset = 0;
        
        surrogate_settings.best_valid = 0;
        surrogate_settings.leniency = 1.0;

        surrogate_settings.text_size = proc.surrogateTextSize;

        // surrogate_settings.minVolume = 10;
        surrogate_settings.skimPercentage = 0.05;

        surrogate_settings.allow_towers = proc.surrogateTowers;
        // surrogate_settings.allow_height_variable = true;
        // surrogate_settings.allow_stackable = true;
        

        let all_slices = [];
        surrogate_settings.all_slices = all_slices;
        surrogate_settings.precomputed_slice_heights = [];
        surrogate_settings.pauseLayers = [];

        surrogate_settings.smallest_length = Infinity;
        surrogate_settings.smallest_width = Infinity;
        surrogate_settings.smallest_height = Infinity;
        surrogate_settings.biggest_length = 0;
        surrogate_settings.biggest_width = 0;
        surrogate_settings.biggest_height = 0;

        for (let surro of surros) {
            if (surrogate_settings.smallest_length > surro.length) {
                surrogate_settings.smallest_length = surro.length;
            }
            if (surrogate_settings.smallest_width > surro.width) {
                surrogate_settings.smallest_width = surro.width;
            }
            if (surrogate_settings.smallest_height > surro.minHeight) {
                surrogate_settings.smallest_height = surro.minHeight;
            }
            if (surrogate_settings.biggest_length < surro.length) {
                surrogate_settings.biggest_length = surro.length;
            }
            if (surrogate_settings.biggest_width < surro.width) {
                surrogate_settings.biggest_width = surro.width;
            }
            if (surrogate_settings.biggest_height < surro.maxHeight) {
                surrogate_settings.biggest_height = surro.maxHeight;
            }
        }

        console.log({surrogate_settings:surrogate_settings});


        // For all slices

        let mina = min; //numOrDefault(min, 0.1);
        let coff = new ClipperLib.ClipperOffset();
        const unreachable_poly = generateRectanglePolygonCentered(1000, 1000, 1000, 10, 10, 0, 0, bottom_slice);


        let char_size = surrogate_settings.text_size/20*4.5;
        

        
        while (up) {
            if (true)
            if (proc.surrogateInteraction != "off") {
                let zed = up.z || 0;

                // console.log({up:up});
                // if (up.tops) {
                //     let overlap_found = false;
                //     if (up.tops.length > 1) {
                //         for (let topsIndex = 0; topsIndex < up.tops.length; topsIndex+=1) {
                //             for (let topsIndex2 = 0; topsIndex2 < up.tops.length; topsIndex2+=1) {
                //                 if (topsIndex != topsIndex2) {
                //                     let outs = [];
                //                     let overlapA = -1*Math.abs(up.tops[topsIndex].poly.areaDeep());
                //                     POLY.subtract([up.tops[topsIndex].poly], [up.tops[topsIndex2].poly], outs, null, up.z, min);
                //                     outs.forEach(function(outP) {
                //                         overlapA += Math.abs(outP.areaDeep());
                //                     });

                //                     if (Math.abs(overlapA) > 0.00001) {
                //                         console.log({overlapA_Before:overlapA});
                //                         // for (let justIterate = 0; justIterate < up.tops[topsIndex].poly.length; justIterate += 1) {
                //                         //     up.tops[topsIndex].poly.points[justIterate].X += 2000000;
                //                         //     up.tops[topsIndex].poly.points[justIterate].x += 20;
                //                         // }
                //                         // for (let justIterate = 0; justIterate < up.tops[topsIndex2].poly.length; justIterate += 1) {
                //                         //     up.tops[topsIndex2].poly.points[justIterate].X += 2000000;
                //                         //     up.tops[topsIndex2].poly.points[justIterate].x += 20;
                //                         // }
                //                         if (!up.tops[0].fill_sparse) up.tops[0].fill_sparse = [];
                //                         // up.tops[0].fill_sparse.push(up.tops[topsIndex].poly);
                //                         // up.tops[0].fill_sparse.push(up.tops[topsIndex2].poly);
                //                         if (!up.supports) up.supports = [];
                //                         // up.supports.push(up.tops[topsIndex].poly);
                //                         // up.supports.push(up.tops[topsIndex2].poly);
                //                         overlap_found = true;
                //                     }


                //                 }
                //             }
                //         }

                //     }
                //     if (overlap_found == false) {
                //         // up.tops = [];
                //     }
                // }


                // Clone and simplify tops
                up.topsSaved = up.tops.clone(true); // Clone tops
                for (let topsIndex = 0; topsIndex < up.topsSaved.length; topsIndex+=1) {
                    // The original top remains mostly intact, only the poly is changed
                    // Clone the poly
                    let originalPoly = up.tops[topsIndex].poly;
                    let inputPoly = originalPoly.clone(true);
                    up.topsSaved[topsIndex].poly = originalPoly; // Put original poly into cloned top.

                    // const perimeterLength = originalPoly.perim;
                    let outputPoly = adaptivePolySimplify(surrogate_settings.simplification_factor, surrogate_settings.simplification_factor+0.5, inputPoly, originalPoly.perim, originalPoly.area2, zed, mina, coff);

                    up.tops[topsIndex].poly = outputPoly;
                    // if (outputPoly.checkOut) {
                    // // if (true) {
                    //     console.log({Note:"Found Warning"});
                    //     if (!up.tops[0].fill_sparse) up.tops[0].fill_sparse = [];
                    //     up.tops[0].fill_sparse.push(outputPoly);
                    // }
                }

                // Removing polygons that are too small, breaking when using subtract and thus causing false positives during search
                if (up.tops) {
                    let newTops = [];
                    for (let topsIndex = 0; topsIndex < up.tops.length; topsIndex+=1) {
                        let primedPoly = []
                        POLY.subtract([up.tops[topsIndex].poly], [unreachable_poly], primedPoly, null, up.z, 0.05);
                        if (primedPoly.length == 1) {
                            if (Math.abs(primedPoly[0].area(true)) < 0.1) {
                                console.log({primedPoly:primedPoly});
                                console.log({inPoly:up.tops[topsIndex].poly});
                            }
                            // up.tops[topsIndex].poly = primedPoly[0];
                            newTops.push(up.tops[topsIndex]);
                            
                        }
                        // } else {    
                        //     console.log({WARNING:"Subtract with nothing changed number of polys"});
                        //     if (up.tops[topsIndex].poly.area2 > 0.01) console.log({WARNING:"AND area was not insignificant."});
                        //     console.log({inPoly:up.tops[topsIndex].poly});
                        //     console.log({primedPoly:primedPoly});
                        //     console.log({inArea2:up.tops[topsIndex].poly.area2});
                        //     if (primedPoly.length > 1) console.log({WARNING:"More than one out poly!!!!!"});
                        // }
                    }
                    up.tops = newTops;
                }


                // In case simplification led to overlaps
                if (up.tops) {
                    if (up.tops.length > 1) {
                        for (let topsIndex = 0; topsIndex < up.tops.length; topsIndex+=1) {
                            for (let topsIndex2 = 0; topsIndex2 < up.tops.length; topsIndex2+=1) {
                                if (topsIndex != topsIndex2) {
                                    let outs = [];
                                    let overlapA = -1*Math.abs(up.tops[topsIndex].poly.areaDeep());
                                    POLY.subtract([up.tops[topsIndex].poly], [up.tops[topsIndex2].poly], outs, null, up.z, 0.05);
                                    outs.forEach(function(outP) {
                                        overlapA += Math.abs(outP.areaDeep());
                                    });

                                    if (Math.abs(overlapA) > 0.00001)  {
                                        // console.log(up.tops[topsIndex].poly);
                                        // console.log(up.tops[topsIndex].poly.area2);
                                        // console.log(outs);
                                        if (outs && outs.length > 0) { // TODO Investigate how 0 can happen
                                            up.tops[topsIndex].poly = outs[0];
                                            up.tops[topsIndex].poly.area2 = up.tops[topsIndex].poly.area(true);
                                        }
                                        // console.log(up.tops[topsIndex].poly.area2);
                                        // console.log({overlapA_After:overlapA});
                                        // if (!up.tops[0].fill_sparse) up.tops[0].fill_sparse = [];
                                        //     // up.tops[0].fill_sparse.push(up.tops[topsIndex].poly);
                                        //     // up.tops[0].fill_sparse.push(up.tops[topsIndex2].poly);
                                        // if (!up.supports) up.supports = [];
                                        // // up.supports.push(up.tops[topsIndex].poly);
                                        // // up.supports.push(up.tops[topsIndex2].poly);
                                        // overlap_found2 = true;
                                    }
                                }
                            }
                        }
                    }
                }


                if (up.tops) {
                    if (up.tops.length > 1) {
                        let collDet = [];
                        POLY.subtract(up.topPolys(), [unreachable_poly], collDet, null, up.z, 0.05);
                        let post_collision_area = 0, pre_collision_area = 0;
                        up.topPolys().forEach(function(top_poly) {
                            pre_collision_area += Math.abs(top_poly.areaDeep());
                        });
                        collDet.forEach(function(top_poly) {
                            post_collision_area += Math.abs(top_poly.areaDeep());
                        });

                        const collision_area = pre_collision_area - post_collision_area;
                        if (collision_area > 0.00001) {
                            console.log({THISSLICE:up});
                            console.log({pre_collision_area:pre_collision_area});
                            console.log({post_collision_area:post_collision_area});
                            console.log({InPolys:up.topPolys()});
                            console.log({AfterNoSubtract:collDet});
                        }
                    }
                }

                // Get manual supports from other widget
                // if (otherWidget) { 
                //     if (otherWidget.slices) {
                //         if (otherWidget.slices.length >= up.index+1) {
                //             if (otherWidget.slices[up.index].tops) {
                //                 if (!up.supports) up.supports = [];
                //                 for (let otherSupportsInd = 0; otherSupportsInd < otherWidget.slices[up.index].tops.length; otherSupportsInd += 1) {
                //                     up.supports.push(otherWidget.slices[up.index].tops[otherSupportsInd].poly);
                //                 }
                //                 otherWidget.slices[up.index].tops = []; // Remove manual supports reference from other widget after moving them to this one
                //             }
                //         }
                //     }
                // }

                if (up.supports) {
                    let unionized_supports = POLY.union(up.supports, min, true);
                    // console.log({unionized_supports:unionized_supports});
                    
                    for (let supportsIndex = 0; supportsIndex < unionized_supports.length; supportsIndex+=1) {
                        unionized_supports[supportsIndex].perim = unionized_supports[supportsIndex].perimeter();
                    }
                    up.supports = unionized_supports;
                }

                // if (up.supports) {
                //     for (let supportsIndex = 0; supportsIndex < up.supports.length; supportsIndex+=1) {
                //         up.supports[supportsIndex].area2 = up.supports[supportsIndex].area(true);
                //     }
                // }

                up.supportsSaved = []; // Make array for cloned supports
                if (up.supports) {
                    for (let supportsIndex = 0; supportsIndex < up.supports.length; supportsIndex+=1) { // Save a copy, then simplify the supports
                        // Clone the poly
                        let originalPoly = up.supports[supportsIndex];
                        let inputPoly = originalPoly.clone(true);
                        inputPoly.area2 = originalPoly.area2;
                        up.supportsSaved.push(originalPoly);

                        // const perimeterLength = originalPoly.perim;
                        let outputPoly = adaptivePolySimplify(surrogate_settings.simplification_factor, surrogate_settings.simplification_factor, inputPoly, originalPoly.perim, originalPoly.area2, zed, mina, coff);

                        up.supports[supportsIndex] = outputPoly;
                        // console.log({outputPoly:outputPoly});
                        // if (outputPoly.checkOut) {
                        // // if (true) {
                        //     console.log({Hint:"Occured"});
                        //     if (!up.tops[0].fill_sparse) up.tops[0].fill_sparse = [];
                        //     up.tops[0].fill_sparse.push(outputPoly);
                        // }
                    }
                }

                // console.log({up:up});
            }

            all_slices.push(up);
            const stopAbove = up.z - surrogate_settings.min_squish_height;
            const skipBelow = up.z;
            surrogate_settings.precomputed_slice_heights.push({stopAbove:stopAbove, skipBelow:skipBelow});
            up = up.up;   

        }
        

        up = bottom_slice;

        // let first_placed = true;

        let pre_surrogate_support_amounts = getTotalSupportVolume(bottom_slice);
        // console.log({pre_surrogate_support_amounts:pre_surrogate_support_amounts});

        surrogate_settings.total_surrogate_volume = pre_surrogate_support_amounts[0];
        surrogate_settings.total_surrogate_area = pre_surrogate_support_amounts[1];


        // console.log({pause_layers_start: settings.process.gcodePauseLayers});

        console.log({min_x:min_x});
        console.log({max_x:max_x});
        console.log({min_y:min_y});
        console.log({max_y:max_y});

        // console.log({widget: bottom_slice.widget});
        // console.log({widget_pos: bottom_slice.widget.track.pos});
        // console.log({bedDepth: settings.device.bedDepth});

        // console.log({bedwidth: settings.device.bedWidth});

        // console.log({shift_x: shift_x});
        // console.log({shift_y: shift_y});


        // Testing if parallel.js is working
        // let parallelTest = new PARALLELENV.Parallel([2, 3, 4, 5], {
        //     env: {
        //       a: 10
        //     },
        //     envNamespace: 'parallel', 
        //     maxWorkers: 12
        // });

        const log = function () { console.log(arguments); };
        
        // function fib(n) {
        //     return n < 2 ? 1 : fib(n - 1) + fib(n - 2);
        //   };
        // parallelTest.map(fib).then(log)




        // Greedy search

        // Iterate, placing a surro in every iteration
        if (searchType == "Greedy") {
            for (let surros_to_place = 0; surros_to_place < surrogate_number_goal; surros_to_place++) {
                let place_one_surro = {};

                
                let sufficient = false; // TODO: Define what is sufficient to stop searching for better solutions
                let repetition_counter = 0;
                let epsilon_0_counter = 0;
                let best_delta_volume = 0;
                let best_insertion_layer_number_guess = 0;

                // Start at bottom
                up = bottom_slice;

                // Try out random options to place surros
                while (sufficient === false && repetition_counter < (Math.floor(repetition_goal / surrogate_number_goal))) { // Loop mostly deprecated with using PSO, but we could run the optimization multiple times with it
                    let good = true;
                    
                    // Set walking slice to lowest slice
                    

                    // TODO: Remove after making sure volume check goes over all relevant slices
                    if (!up.supports || up.supports.length === 0) {
                        up = up.up;
                        repetition_counter++;
                        console.log({going_up: "Going up because there were no supports on this slice"});
                        good = false;
                        continue;
                    }

                    let stack_on_surro_index = Math.floor(Math.random() * (surrogates_placed.length + 1)) - 1; // -1 to try to place it on buildplate
                    try_x = Math.random() * (max_x - min_x) + min_x;
                    try_y = Math.random() * (max_y - min_y) + min_y;
                    try_z = 0; // TODO: Convert height to slice number???
                    
                    if (stack_on_surro_index >= 0) {
                        // console.log({surrogates_placed:surrogates_placed});
                        // console.log({stack_on_surro_index:stack_on_surro_index});
                        try_z = surrogates_placed[stack_on_surro_index].starting_height + surrogates_placed[stack_on_surro_index].surro.height;// + layer_height_fudge;
                    }
                    try_rotation = rotations[Math.floor(Math.random() * rotations.length)];
                    try_surro_index = Math.floor(Math.random() * surros.length)
                    try_surro = surros[try_surro_index];
                    let try_surro_polygons_list = []
                    if (try_surro.type == "simpleRectangle") {
                        try_surro_polygons_list = [generateRectanglePolygonCentered(try_x, try_y, up.z, try_surro.length, try_surro.width, try_rotation, surrogate_settings.surrogate_padding, bottom_slice)];
                    }
                    else if (try_surro.type == "prism") {
                        try_surro_polygons_list = [generatePrismPolygon(try_x, try_y, up.z, try_surro.prism_geometry, try_rotation, surrogate_settings.surrogate_padding, bottom_slice)];
                    }
                    let collision = false;
                    let overextended = false;
                    let new_volume = 0, old_volume = 0;
                    let delta_volume = 0;
                    let insertion_layer_number_guess = 0;

                    // Single surrogate handling
                    // try_x = pso_position_vars[1];
                    // try_y = pso_position_vars[2];

                    // let pso_chosen_surro = Math.floor(pso_position_vars[5]);
                    // if (pso_chosen_surro >= surros.length) {
                    //     pso_chosen_surro = surros.length-1;
                    // }
                    // else if (pso_chosen_surro < 0) {
                    //     pso_chosen_surro = 0;
                    // }
                    // // let pso_chosen_surro = pso_position_vars[5];
                    // // if (pso_chosen_surro < 0) pso_chosen_surro = 0;
                    // // else if (pso_chosen_surro >= surros.length) pso_chosen_surro = surros.length-1;
                    // // try_surro = surros[Math.floor(pso_chosen_surro)];
                    // try_rotation = pso_position_vars[4];

                    // if (try_surro.type == "simpleRectangle") {
                    //     try_surro_polygons_list = [generateRectanglePolygonCentered(try_x, try_y, up.z, try_surro.length, try_surro.width, try_rotation, surrogate_settings.surrogate_padding, bottom_slice)];
                    // }
                    // else if (try_surro.type == "prism") {
                    //     try_surro_polygons_list = [generatePrismPolygon(try_x, try_y, up.z, try_surro.prism_geometry, try_rotation, surrogate_settings.surrogate_padding, bottom_slice)];
                    // }


                    // // Check if surrogate is available
                    if (try_surro.available === false) {
                        repetition_counter++;
                        good = false;
                        continue;
                    }

                    // Rotation debug test
                    // if (first_placed === true) {
                    //     rotations.forEach(function(rotation) {
                    //         if (rotation < 130) {
                    //             console.log({rotation:rotation});
                    //             // let rot_test_geometry_list = [generateRectanglePolygonCentered(try_x, try_y, 0, 50, 100, rotation, surrogate_settings.surrogate_padding, bottom_slice)];
                    //             let rot_test_geometry_list = [generatePrismPolygon(try_x, try_y, up.z, try_surro.prism_geometry, rotation, surrogate_settings.surrogate_padding, bottom_slice)];
                    //             bottom_slice.tops[0].shells.push(rot_test_geometry_list[0]);
                    //         }

                    //     });
                    //     first_placed = false;
                    // }


                    // Check that surrogates don't end on consecutive layers

                    

                    // // Out of build-area check
                    for (let surro_poly of try_surro_polygons_list) {
                        // translate widget coordinate system to build plate coordinate system and compare with build plate size (center is at 0|0, bottom left is at -Width/2<|-Depth/2)
                        if (surro_poly.bounds.maxx + shift_x > bedWidthArea || surro_poly.bounds.minx + shift_x < -bedWidthArea || surro_poly.bounds.maxy + shift_y > bedDepthArea || surro_poly.bounds.miny + shift_y < -bedDepthArea || try_z + try_surro.minHeight > settings.device.bedDepth) {
                            // console.log({text:"Out of build area"});
                            // console.log({surro_poly_bounds:surro_poly.bounds})
                            // console.log({y_max:surro_poly.bounds.maxy + shift_y})
                            // console.log({y_min:surro_poly.bounds.miny + shift_y})
                            // console.log({max_area:bedDepthArea})
                            // console.log({min_area:-bedDepthArea})
                            repetition_counter++;
                            good = false;
                            continue;
                        }
                    }

                    // Stability check
                    if (stack_on_surro_index >= 0) {
                        let unsupported_polygons = [];
                        let unsupp_area = 0, full_area = 0;
                        POLY.subtract(try_surro_polygons_list, surrogates_placed[stack_on_surro_index].geometry, unsupported_polygons, null, up.z, min);
                        unsupported_polygons.forEach(function(unsupp) {
                            unsupp_area += Math.abs(unsupp.areaDeep());
                        });
                        try_surro_polygons_list.forEach(function(full) {
                            full_area += Math.abs(full.areaDeep());
                        });

                        // If less than half the area of the new surro is supported by the surro below, surrogate is unstable
                        //if ((unsupp_area * 2) > full_area) {
                        // For now, use 100% support instead
                        if (unsupp_area > 0) {
                            repetition_counter++;
                            good = false;
                            continue;
                        }
                    }

                    let collision_and_volumes = [];

                    // Check collisions and calculate volume
                    if (true) {

                        collision_and_volumes = checkVolumeAndCollisions(surros, surrogate_settings, bottom_slice, try_surro_index, try_surro_polygons_list, try_z, surrogates_placed);

                        // console.log({collision_and_volumes:collision_and_volumes});
                        if (false) {
                            let iterate_layers_VandC = bottom_slice;

                            // Check for collision for the whole surrogate height
                            while (collision === false && iterate_layers_VandC && overextended === false) { // Stop after first collision found, or end of widget reached
                                
                                // Increase height until surrogate starting height is reached 
                                // Approximation: If more than half of the slice height is surrogated, we count it fully (for volume) #TODO: for collisions we might want to check for ANY overlap
                                if (iterate_layers_VandC.z < try_z) { // LWW TODO: Check at what height we actually want to start checking for collisions
                                    iterate_layers_VandC = iterate_layers_VandC.up;
                                    // console.log({going_up: "Going up because surro is not on buildplate my DUDE!!!!!!!"});
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
                                let slice_height_range = get_height_range(iterate_layers_VandC);
                                
                                // Skip volume count for layers that have no supports
                                if (!iterate_layers_VandC.supports || iterate_layers_VandC.supports.length === 0) {
                                    calculating_volume = false;
                                }
                                // Stop counting volume once surrogate height has passed 
                                else if ((slice_height_range.bottom_height + surrogate_settings.min_squish_height) >= (try_surro.maxHeight + try_z)){
                                    calculating_volume = false;
                                }

                                // stop checking collisions when surrogate top is higher than slice bottom + min squish height 
                                if ((slice_height_range.bottom_height + surrogate_settings.min_squish_height) >= (try_surro.maxHeight + try_z)) { 
                                    check_collisions = false;
                                }
                                
                                if (calculating_volume) {
                                    const volumes = getSurrogateReplacedVolumes(old_volume, new_volume, iterate_layers_VandC, try_surro_polygons_list);
                                    old_volume = volumes[0];
                                    new_volume = volumes[1];
                                }

                                if (check_collisions) {
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
                                    
                                    if (Math.abs(post_collision_area - pre_collision_area) > 0.00001) { // rounded the same
                                        if ((slice_height_range.bottom_height + surrogate_settings.min_squish_height) < (try_surro.minHeight + try_z)) {
                                            collision = true;
                                            console.log(Math.abs(post_collision_area - pre_collision_area));
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

                                            if (iterate_layers_VandC.z <= (previous_surrogate.surro.height + previous_surrogate.starting_height) && iterate_layers_VandC.z >= previous_surrogate.starting_height) {

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
                                                
                                                if (Math.abs(post_collision_area - pre_collision_area) > 0.00001) {
                                                    if ((slice_height_range.bottom_height + surrogate_settings.min_squish_height) < (try_surro.minHeight + try_z)) {
                                                        collision = true;
                                                        console.log(Math.abs(post_collision_area - pre_collision_area));
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
                                    repetition_counter++;
                                    break;
                                }

                                // Step up
                                iterate_layers_VandC = iterate_layers_VandC.up;
                                // insertion_layer_number_guess = iterate_layers_VandC.index;
                            }
                            if (collision) {
                                good = false;
                                repetition_counter++;
                                continue;
                            }
                        }

                    }
                    if (collision_and_volumes[0] === true) {
                        good = false;
                        repetition_counter++;
                        continue;
                    }
                    old_volume = collision_and_volumes[1];
                    new_volume = collision_and_volumes[2];
                    delta_volume = old_volume - new_volume;

                    // console.log({old_volume:old_volume});
                    // console.log({new_volume:new_volume});
                    // console.log({delta_volume:delta_volume});



                    // generate candidate and validation insertion case and layer
                    let lower_surro = [];
                    let empty_array = [];
                    let data_array = {insertion_case:"unknown"};
                    if (stack_on_surro_index >= 0) {
                        lower_surro.push(surrogates_placed[stack_on_surro_index]);
                    }
                    let end_height = try_z + try_surro.height;
                    let candidate = {
                        geometry:try_surro_polygons_list, 
                        rotation:try_rotation,
                        surro:try_surro, starting_height:try_z, 
                        end_height:end_height, 
                        down_surrogate:lower_surro, 
                        up_surrogate:empty_array, 
                        outlines_drawn:0, 
                        insertion_data:data_array
                    };

                    // console.log({candidate:candidate});
                    check_surrogate_insertion_case(candidate, bottom_slice, surrogate_settings);

                    // Check if it is on a consecutive layer from a previous surrogate
                    let consecutive = false;
                    surrogates_placed.forEach(function(surrogate) {
                        if (Math.abs(candidate.insertion_data.index - surrogate.insertion_data.index) === 1) {
                            consecutive = true;
                        }
                    });
                    if (consecutive) {
                        good = false;
                        repetition_counter++;
                        continue;
                    }

                    // Check if better valid position was found
                    if (good === true && delta_volume > best_delta_volume) {
                        best_delta_volume = delta_volume;
                        place_one_surro = candidate;
                    }
                    // If it is just as good --> choose the bigger one
                    else if (good === true && delta_volume === best_delta_volume && delta_volume > 0) {
                        // Check if the new surrogate is bigger
                        if (!(Object.keys(place_one_surro).length === 0) && place_one_surro.geometry[0].area > try_surro_polygons_list[0].area) { // LWW TODO: Adjust for more complicated geometry
                            console.log({Notification:"A surrogate replaced the same amount of support, but was bigger"});
                            place_one_surro = candidate;
                        }
                        else {
                            epsilon_0_counter++;
                        }
                    }

                    //console.log({best_delta_volume:best_delta_volume});

                    repetition_counter++;
                }
                console.log({best_delta_volume:best_delta_volume});
                console.log({epsilon_0_counter:epsilon_0_counter});
                //test_surro_rectangle_list.push(place_one_surro.geometry[0])
                if (best_delta_volume > 1) { // TODO
                    surrogates_placed.push(place_one_surro);
                    place_one_surro.surro.available = false; // Mark surro as used

                    console.log({placed_surro_name:place_one_surro.surro.id});
                    // console.log({the_surro:place_one_surro.surro});
                    // console.log({the_surro2:surros[try_surro_index]});
                }
            }
        }



        // Optimizer search

        if (searchType == "PSO") {
            // Optimizer area ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
            let valid_answers = [];
            var optimizer = new kiri.Optimizer();
            // var optimizer = new PSO.Optimizer(); // TODO: Add min and max values for particle variable ranges
            optimizer.surrogate_library = surros;
            optimizer.surrogate_settings = surrogate_settings;
            optimizer.valid_answers = [];
            // set the objective function
            optimizer.setObjectiveFunction(function (var_list, done) { 
                if (var_list[0] < 1) var_list[0] = 1.0;
                // console.log({var_list:var_list});
                // let test_x = Math.random() * (max_x - min_x) + min_x;
                // let test_y = Math.random() * (max_y - min_y) + min_y;
                // let test_z = 0; // TODO: Convert height to slice number???
                
                // try_rotation = rotations[Math.floor(Math.random() * rotations.length)];
                // try_surro_index = Math.floor(Math.random() * surros.length);
                // try_surro = surros[try_surro_index];
                //let test_poly = generateRectanglePolygonCentered(test_x, test_y, 0, 100, 50, 0, 0.1);
                // console.log({this:this});


                // let parallel_spawner = new PARALLELENV.Parallel([var_list, this.surrogate_settings, this.surrogate_library], {
                //     env: {
                //       a:10
                //     },
                //     envNamespace: 'parallel'
                // });
        
                // const log = function () { 
                //     console.log({note:"Logging_from_parallel"});
                //     console.log({arguments_log:arguments});
                //     return arguments;
                // };
                // console.log({note:"Before_parallel"});
                // // let temp_fitness = parallel_spawner.spawn(placeAndEval).then(log);

                // parallel_spawner.spawn(function (data) {
                //     placeAndEval(data);
                //     return data;
                // }).then(function (data) {
                //     console.log(data) // logs sdrawrof
                // });
                // console.log({note:"After_parallel"});



                // Parallel solution
                // console.log({save_settings:this.surrogate_settings.number_of_vars});
                // bottom_slice.down = null;
                // bottom_slice.up = null;
                // const p = new PARALLELENV.Parallel(var_list, {
                //     env: {
                //         number_of_vars:this.surrogate_settings.number_of_vars,
                //         surrogate_padding:this.surrogate_settings.surrogate_padding,
                //         min_squish_height:this.surrogate_settings.min_squish_height,
                //         max_extra_droop_height:this.surrogate_settings.max_extra_droop_height,
                //         minimum_clearance_height:this.surrogate_settings.minimum_clearance_height,
                //         rotations:this.surrogate_settings.rotations,
                //         print_on_surrogate_extra_height_for_extrusion:this.surrogate_settings.print_on_surrogate_extra_height_for_extrusion,
                //         layer_height_fudge:this.surrogate_settings.layer_height_fudge = layer_height_fudge,
                //         searchspace_max_number_of_surrogates:this.surrogate_settings.searchspace_max_number_of_surrogates,
                //         // start_slice:this.surrogate_settings.start_slice,
                //         existing_surrogates:this.surrogate_settings.existing_surrogates,
                //         number_of_vars:this.surrogate_settings.number_of_vars,
                
                //         fitness_offset:this.surrogate_settings.fitness_offset,
                //         best_valid:this.surrogate_settings.best_valid,
                //         leniency:this.surrogate_settings.leniency,

                //     }
                // });

                // p.spawn(var_list => {
                //     console.log({note:"Doing anything1"});
                //     console.log({environment_gotten:global.env.number_of_vars});
                //     // for (let INDX = 0; INDX < var_list.length; INDX++) {
                //     //     console.log({var_list:var_list[INDX]});
                //     // }
                //     let all_surrogates = [];
                //     for (old_surrogate of this.surrogate_settings.existing_surrogates) {
                //         all_surrogates.push(old_surrogate);
                //     };
                //     let new_surrogates = [];
                //     let results_array = [];

                //     // let pso_collision_and_volumes = checkVolumeAndCollisions(surros, optimizer.surrogate_settings, bottom_slice, try_surro_index, try_surro_polygons_list, try_z, surrogates_placed);

                //     // for (let iteration_number = 0; iteration_number < this.surrogate_settings.searchspace_max_number_of_surrogates; iteration_number++) {
                //     for (let iteration_number = 0; iteration_number < 6; iteration_number++) {

                //         // if (var_list[0] >= iteration_number) {
                //         if(true) {
                //             console.log({note:"Doing anything"});

                //             // Select test surrogate
                //             let library_index = Math.floor(var_list[iteration_number*this.surrogate_settings.number_of_vars + 5]);
                //             if (library_index >= this.surrogate_library.length) {
                //                 library_index = this.surrogate_library.length-1;
                //             }
                //             else if (library_index < 0) {
                //                 library_index = 0;
                //             }
                //             let pso_surrogate = this.surrogate_library[library_index];

                //             // Select test tower position/on baseplate
                //             let pso_z = 0;
                //             let tower_library_index = 0;
                //             if (var_list[iteration_number*this.surrogate_settings.number_of_vars + 3] >= 1) {
                //                 tower_library_index = 0.99999;
                //             }
                //             else if (var_list[iteration_number*this.surrogate_settings.number_of_vars + 3] < 0) {
                //                 tower_library_index = 0;
                //             }
                //             else tower_library_index = var_list[iteration_number*this.surrogate_settings.number_of_vars + 3];
                //             tower_library_index = Math.floor(tower_library_index * (all_surrogates.length+1)); // #previous surrogates + 1 for on-baseplate
                //             tower_library_index = tower_library_index - 1; 
                //             if (tower_library_index > 0) pso_z = all_surrogates[tower_library_index].starting_height + all_surrogates[tower_library_index].surro.height;
                            

                            
                //             // generate polygons // TODO: Is it faster to make one poly for the surrogate and then rotate+translate /modify the points directly?
                //             let pso_polygons_list = []
                //             if (pso_surrogate.type == "simpleRectangle") {
                //                 pso_polygons_list = [generateRectanglePolygonCentered(var_list[iteration_number*this.surrogate_settings.number_of_vars + 1], var_list[iteration_number*this.surrogate_settings.number_of_vars + 2], this.surrogate_settings.start_slice.z, pso_surrogate.length, pso_surrogate.width, var_list[iteration_number*this.surrogate_settings.number_of_vars + 4], surrogate_settings.surrogate_padding, this.surrogate_settings.start_slice)];
                //             }
                //             else if (pso_surrogate.type == "prism") {
                //                 pso_polygons_list = [generatePrismPolygon(var_list[iteration_number*this.surrogate_settings.number_of_vars + 1], var_list[iteration_number*this.surrogate_settings.number_of_vars + 2], this.surrogate_settings.start_slice.z, pso_surrogate.prism_geometry, var_list[iteration_number*this.surrogate_settings.number_of_vars + 4], surrogate_settings.surrogate_padding, this.surrogate_settings.start_slice)];
                //             }


                //             // Out of build-area check
                //             for (let pso_poly of pso_polygons_list) {
                //                 // translate widget coordinate system to build plate coordinate system and compare with build plate size (center is at 0|0, bottom left is at -Width/2<|-Depth/2)
                //                 if (pso_poly.bounds.maxx + shift_x > bedWidthArea || pso_poly.bounds.minx + shift_x < -bedWidthArea || pso_poly.bounds.maxy + shift_y > bedDepthArea || pso_poly.bounds.miny + shift_y < -bedDepthArea || pso_z + pso_surrogate.height > settings.device.bedDepth) {
                //                     continue; // TODO: save for return later the negative size of overlap for this test part?
                //                 }
                //             }

                //             // Stability check
                //             if (tower_library_index >= 0) {
                //                 let unsupported_polygons = [];
                //                 let unsupp_area = 0, full_area = 0;
                //                 POLY.subtract(pso_polygons_list, all_surrogates[tower_library_index].geometry, unsupported_polygons, null, this.surrogate_settings.start_slice.z, min);
                //                 unsupported_polygons.forEach(function(unsupp) {
                //                     unsupp_area += Math.abs(unsupp.areaDeep());
                //                 });
                //                 pso_polygons_list.forEach(function(full) {
                //                     full_area += Math.abs(full.areaDeep());
                //                 });

                //                 // If less than half the area of the new surro is supported by the surro below, surrogate is unstable
                //                 //if ((unsupp_area * 2) > full_area) {
                //                 // For now, use 100% support instead
                //                 if (unsupp_area > 0) {
                                    
                //                     continue;
                //                 }
                //             }

                //             let pso_collision_and_volumes = checkVolumeAndCollisions(this.surrogate_library, this.surrogate_settings, this.surrogate_settings.start_slice, library_index, pso_polygons_list, pso_z, all_surrogates);
                //             const delta_volume = pso_collision_and_volumes[1] - pso_collision_and_volumes[2];
                //             if (delta_volume > 0) {
                //                 results_array.push(pso_collision_and_volumes);
                //                 // console.log({pso_collision_and_volumes:pso_collision_and_volumes});
                //                 if (pso_collision_and_volumes[0] === false) var_list[iteration_number*this.surrogate_settings.number_of_vars + 7] = 1;
                //                 else var_list[iteration_number*this.surrogate_settings.number_of_vars + 7] = 0;

                //                 if (pso_collision_and_volumes[0] === false) { // No collision
                //                     // save successful candidate // TODO: (and validation insertion case and layer)
                //                     let lower_surrogate = [];
                //                     let empty_array = [];
                //                     let data_array = {insertion_case:"unknown"};
                //                     if (stack_on_surro_index >= 0) {
                //                         lower_surrogate.push(all_surrogates[tower_library_index]);
                //                     }
                //                     let end_height = pso_z + pso_surrogate.height;
                //                     let candidate = {
                //                         geometry:pso_polygons_list, 
                //                         surro:pso_surrogate, starting_height:pso_z, 
                //                         end_height:end_height, 
                //                         down_surrogate:lower_surrogate, 
                //                         up_surrogate:empty_array, 
                //                         outlines_drawn:0, 
                //                         insertion_data:data_array
                //                     };

                //                     check_surrogate_insertion_case(candidate, this.surrogate_settings.start_slice, this.surrogate_settings);

                //                     all_surrogates.push(candidate);
                //                     new_surrogates.push(candidate);



                //                 } else {
                                    
                //                 }
                //             }
                //         }
                //     }

                //     let valid_combination = true;
                //     let total_surrogates_volume = this.surrogate_settings.fitness_offset;
                //     let total_collided_surrogates_volume = 0;
                //     let interaction_layer_set = new Set();
                //     let collision_area_estimate = 0;
                //     let surrogate_area_estimate = 0;
                //     const number_of_surrogates = all_surrogates.length;


                //     for (const result of results_array) {
                //         if (result[0] === true) { // Collided surrogates
                //             valid_combination = false;
                //             const delta_volume = result[1] - result[2];
                //             total_collided_surrogates_volume += delta_volume;
                //             collision_area_estimate += result[3]; // Get overlap area estimate
                //             surrogate_area_estimate += result[4];
                //         }
                //         else { // Good surrogates
                //             const delta_volume = result[1] - result[2];
                //             total_surrogates_volume += delta_volume; // Get surrogated volume
                //         }
                        
                        

                //         // let delta_volume = result[1] - result[2] + this.surrogate_settings.fitness_offset;

                //     }

                //     for (const surrogate of all_surrogates) {
                //         interaction_layer_set.add(surrogate.insertion_data.new_layer_index) // Get number of interaction layers // TODO: add extra interactions as penalty for difficult surrogates (bridges, stacks...)
                //     }

                //     const number_of_interactions = interaction_layer_set.size;
                //     let fitness = 0;

                //     if (total_surrogates_volume > 0) {
                //         // console.log({interaction_layer_set:interaction_layer_set});
                //         // console.log({all_surrogates:all_surrogates});
                //         const w_pieces = 0.3;
                //         const w_interactions = 0.7;
                //         const surrogate_N_penalty_factor = 0;//0.8;
                //         const interaction_N_penalty_factor = 0;//0.35;


                //         // console.log({total_surrogates_volume:total_surrogates_volume});
                //         fitness = total_surrogates_volume / (w_pieces * Math.pow(number_of_surrogates, surrogate_N_penalty_factor) + w_interactions * Math.pow(number_of_interactions, interaction_N_penalty_factor));
                //     }

                    
                //     if (valid_combination) console.log({valid_combination:valid_combination});
                    
                //     if (valid_combination === false && total_collided_surrogates_volume > 0) {
                //         let overlap_factor = (collision_area_estimate / surrogate_area_estimate);
                //         if (overlap_factor > 1) overlap_factor = 1.0;
                //         // console.log({overlap_factor:pso_collision_and_volumes[3]});
                //         // if (fitness > this.surrogate_settings.best_valid) fitness = this.surrogate_settings.best_valid;
                //         total_collided_surrogates_volume = total_collided_surrogates_volume * (1.0-overlap_factor); // Reduce by overlap percentage
                //         if (this.surrogate_settings.leniency >= 0) {
                //             if (Math.random() >= this.surrogate_settings.leniency) {
                //                 // delta_volume = delta_volume * this.surrogate_settings.leniency;
                //                 fitness = fitness + (total_collided_surrogates_volume)*0.01
                //                 console.log({fitness:fitness});
                //                 done(fitness); 
                //             }
                //             else {
                //                 fitness = fitness + (total_collided_surrogates_volume)*0.01
                //                 console.log({fitness:fitness});
                //                 done(fitness);
                //             }
                //             // delta_volume = delta_volume * this.surrogate_settings.leniency;
                //             // return delta_volume;
                //         }
                //         else {
                //             // Doesn't happen yet. Restore negative numbers that describe overlap area
                //             console.log({error:"Objective function: Should not have reached this"});
                //         }
                //     } else {
                //         console.log({fitness:fitness});
                //         done(fitness); 
                //     }
                // });

                // .then(done(data));

                // let temp_fitness = placeAndEval([var_list, this.surrogate_settings, this.surrogate_library]);
                // console.log({temp_fitness:temp_fitness});
                // return temp_fitness;





                // Using kiri worker for parallel execution
                if (false) {
                    let temp_worker = new Worker(`/code/worker.js?${self.kiri.version}`);


                    let seq = 1000000;
                    let fun = "surrogate";

                    const state = { zeros: [] };
                    let encoded_slice = bottom_slice.encode(state);
                    console.log({encoded_slice:encoded_slice});
                    let decoded_slice = KIRI.codec.decode(encoded_slice, {mesh:slice.widget.mesh});
                    console.log({decoded_slice:decoded_slice});


                    temp_worker.postMessage({
                        seq: seq,
                        task: fun,
                        time: time(),
                        data: var_list
                    }, this.surrogate_settings);


                    temp_worker.onmessage = get_message;
                    
                    function get_message(data, msg) {
                        console.log({received_data:data.data.data});
                        // console.log({received_msg:msg});
                        done(data.data.data)
                    }
                }


                // placeAndEval function, original source
                else {
                    let all_surrogates = [];
                    for (old_surrogate of this.surrogate_settings.existing_surrogates) {
                        all_surrogates.push(old_surrogate);
                    };
                    let new_surrogates = [];
                    let results_array = [];

                    let average_overlap_factor = 0;
                    let overlap_counter = 0;


                    let results_meta_data = {valid:false, candidate_details:[], fitness:Number.NEGATIVE_INFINITY};

                    // let pso_collision_and_volumes = checkVolumeAndCollisions(surros, optimizer.surrogate_settings, bottom_slice, try_surro_index, try_surro_polygons_list, try_z, surrogates_placed);

                    if (var_list[0] < this.surrogate_settings.searchspace_min_number_of_surrogates) var_list[0] = this.surrogate_settings.searchspace_min_number_of_surrogates;
                    const max_tries = var_list[0];
                    

                    for (let iteration_number = 0; iteration_number < this.surrogate_settings.searchspace_max_number_of_surrogates; iteration_number++) {
                        let pso_use_this_surrogate = 0;
                        let tower_details = {tower_x:null, tower_y:null};
                        if (max_tries >= iteration_number+1) {

                            // Name parameters for easy handling
                            let pso_x = var_list[iteration_number*this.surrogate_settings.number_of_vars + 1];
                            let pso_y = var_list[iteration_number*this.surrogate_settings.number_of_vars + 2];
                            let pso_tower_index = var_list[iteration_number*this.surrogate_settings.number_of_vars + 3];
                            let pso_rotation = var_list[iteration_number*this.surrogate_settings.number_of_vars + 4];
                            // let pso_library_index = var_list[iteration_number*this.surrogate_settings.number_of_vars + 5];

                            // let pso_use_this_surrogate = var_list[iteration_number*this.surrogate_settings.number_of_vars + 7];

                            // if(true) {
                            // Select test surrogate // Old way letting PSO select library index
                            // if (pso_library_index >= this.surrogate_library.length) {
                            //     pso_library_index = this.surrogate_library.length - (pso_library_index - this.surrogate_library.length); // Bounce of max index of available surrogates
                            // }
                            // else if (pso_library_index < 0) {
                            //     pso_library_index = -pso_library_index; // Bounce of start of surrogate list index 
                            // }
                            // var_list[iteration_number*this.surrogate_settings.number_of_vars + 5] = pso_library_index; // update PSO variable with bounced value
                            // const library_index = Math.floor(pso_library_index);
                            // let pso_surrogate = this.surrogate_library[library_index];

                            let pso_desired_length = var_list[iteration_number*this.surrogate_settings.number_of_vars + 5];
                            let pso_desired_width = var_list[iteration_number*this.surrogate_settings.number_of_vars + 6];
                            let pso_desired_height = var_list[iteration_number*this.surrogate_settings.number_of_vars + 7];

                            let pso_surrogate = getBestFittingSurrogateL2(this.surrogate_library, pso_desired_length, pso_desired_width, pso_desired_height);

                            // Select test tower position/on baseplate
                            let pso_z = 0;
                            let tower_library_index = -1;
                            if (this.surrogate_settings.allow_towers == true) {
                                if (pso_tower_index >= 1) {
                                    tower_library_index = 0.99999;
                                    pso_tower_index = 1 - (pso_tower_index - 1); // bounce
                                    var_list[iteration_number*this.surrogate_settings.number_of_vars + 3] = pso_tower_index; // update PSO variable with bounced value
                                }
                                else if (pso_tower_index < 0) {
                                    tower_library_index = 0;
                                    if (pso_tower_index < -1) {
                                        pso_tower_index = -1 - (pso_tower_index + 1); // bounce
                                        var_list[iteration_number*this.surrogate_settings.number_of_vars + 3] = pso_tower_index; // update PSO variable with bounced value
                                    }
                                }
                                else tower_library_index = pso_tower_index;
                         
                            
                                tower_library_index = Math.floor(tower_library_index * (all_surrogates.length+1)); // #previous surrogates + 1 for on-baseplate
                                tower_library_index = tower_library_index - 1; // -1 equals build plate
                                // if (all_surrogates.length > 0) {
                                //     console.log({number_surrogate:all_surrogates.length});
                                //     console.log({tower_library_index:tower_library_index});
                                //     console.log({pso_tower_index:pso_tower_index});
                                // }

                                // if (tower_library_index >= 0) pso_z = all_surrogates[tower_library_index].starting_height + all_surrogates[tower_library_index].surro.height;
                                if (tower_library_index >= 0) pso_z = all_surrogates[tower_library_index].end_height;

                                // if (tower_library_index >= 0)
                                // if (all_surrogates[tower_library_index].starting_height + all_surrogates[tower_library_index].surro.height != all_surrogates[tower_library_index].end_height) {
                                //     if (all_surrogates[tower_library_index].surro.type == "simpleRectangle") {
                                //         console.log({WARNING:"End height not equal height + starting height"});
                                //         console.log({addedHeight:all_surrogates[tower_library_index].starting_height + all_surrogates[tower_library_index].surro.height});
                                //         console.log({end_height:all_surrogates[tower_library_index].end_height});
                                //     }
                                // }
                            }

                            let chosen_rotation,
                                chosen_x,
                                chosen_y;
                        
                            // Stability check V2 // TODO: Allow altering rotations
                            if (tower_library_index >= 0) {
                                let x_space = (all_surrogates[tower_library_index].surro.length - pso_surrogate.length - 2.4) * 0.5; // TODO: Set to four times nozzle (+ two times padding size?)
                                let y_space = (all_surrogates[tower_library_index].surro.width - pso_surrogate.width - 2.4) * 0.5;
                                if (x_space > 0 && y_space > 0) {

                                    // Handling without rotation :/
                                    // chosen_rotation = all_surrogates[tower_library_index].rotation;
                                    let mid_x = (all_surrogates[tower_library_index].geometry[0].bounds.maxx + all_surrogates[tower_library_index].geometry[0].bounds.minx)*0.5;
                                    let mid_y = (all_surrogates[tower_library_index].geometry[0].bounds.maxy + all_surrogates[tower_library_index].geometry[0].bounds.miny)*0.5
                                    // if (pso_x > mid_x + x_space) chosen_x = mid_x + x_space;
                                    // else if (pso_x < mid_x - x_space) chosen_x = mid_x - x_space;
                                    // else chosen_x = pso_x;
                                    // if (pso_y > mid_y + y_space) chosen_y = mid_y + y_space;
                                    // else if (pso_y < mid_y - y_space) chosen_y = mid_y - y_space;
                                    // else chosen_y = pso_y;

                                    chosen_rotation = all_surrogates[tower_library_index].rotation;
                     
                                    const degRot = all_surrogates[tower_library_index].rotation * Math.PI / 180;
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


                                    if (all_surrogates[tower_library_index].surro.type == "prism") { // In case of prism underneath, check for unsupported area
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

                                        POLY.subtract(pso_temp_polygons_list, all_surrogates[tower_library_index].geometry, unsupported_polygons, null, this.surrogate_settings.start_slice.z, min);
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

                                            POLY.subtract(pso_temp_polygons_list, all_surrogates[tower_library_index].geometry, unsupported_polygons, null, this.surrogate_settings.start_slice.z, min);
                                            unsupported_polygons.forEach(function(unsupp) {
                                                unsupp_area += Math.abs(unsupp.areaDeep());
                                            });

                                            if (unsupp_area > 0) {
                                                continue;
                                            }
                                        }
                                    }


                                    // console.log({Note:"Valid tower"});
                                    // console.log({pso_surrogate:pso_surrogate});
                                    // console.log({bottom_surrogate:all_surrogates[tower_library_index]});
                                    // let x_move = pso_x % x_space; // Convert to local coordinates
                                    // let y_move = pso_y % y_space;
                                    // chosen_x = (all_surrogates[tower_library_index].geometry[0].bounds.maxx + all_surrogates[tower_library_index].geometry[0].bounds.minx)*0.5 + x_move; // Add chosen distance to mid point
                                    // chosen_y = (all_surrogates[tower_library_index].geometry[0].bounds.maxy + all_surrogates[tower_library_index].geometry[0].bounds.miny)*0.5 + y_move;
                                }
                                else { // insufficient room on top of surrogate
                                    // console.log({Note:"Bad tower"});
                                    // console.log({pso_surrogate:pso_surrogate});
                                    // console.log({bottom_surrogate:all_surrogates[tower_library_index]});
                                    continue;
                                }
                            } else { // No tower chosen
                                chosen_rotation = pso_rotation;
                                chosen_x = pso_x;
                                chosen_y = pso_y;
                            }

                            // // Stability check V1
                            // if (tower_library_index >= 0) {
                            //     let unsupported_polygons = [];
                            //     let unsupp_area = 0, full_area = 0;
                            //     POLY.subtract(pso_polygons_list, all_surrogates[tower_library_index].geometry, unsupported_polygons, null, this.surrogate_settings.start_slice.z, min);
                            //     unsupported_polygons.forEach(function(unsupp) {
                            //         unsupp_area += Math.abs(unsupp.areaDeep());
                            //     });
                            //     pso_polygons_list.forEach(function(full) {
                            //         full_area += Math.abs(full.areaDeep());
                            //     });

                            //     // If less than half the area of the new surro is supported by the surro below, surrogate is unstable
                            //     //if ((unsupp_area * 2) > full_area) {
                            //     // For now, use 100% supported instead
                            //     if (unsupp_area > 0) {
                                    
                            //         continue;
                            //     }
                            // }

                            
                            // generate polygons // TODO: Is it faster to make one poly for the surrogate and then rotate+translate /modify the points directly?
                            let pso_polygons_list = []
                            if (pso_surrogate.type == "simpleRectangle" || pso_surrogate.type == "stackable") {
                                pso_polygons_list = [generateRectanglePolygonCentered(chosen_x, chosen_y, pso_z, pso_surrogate.length, pso_surrogate.width, chosen_rotation, surrogate_settings.surrogate_padding, this.surrogate_settings.start_slice)];
                            }
                            else if (pso_surrogate.type == "prism") {
                                pso_polygons_list = [generatePrismPolygon(chosen_x, chosen_y, pso_z, pso_surrogate.prism_geometry, chosen_rotation, surrogate_settings.surrogate_padding, this.surrogate_settings.start_slice)];
                            }


                            // Out of build-area check
                            for (let pso_poly of pso_polygons_list) {
                                // translate widget coordinate system to build plate coordinate system and compare with build plate size (center is at 0|0, bottom left is at -Width/2|-Depth/2)
                                if (pso_poly.bounds.maxx + shift_x > bedWidthArea || pso_poly.bounds.minx + shift_x < -bedWidthArea || pso_poly.bounds.maxy + shift_y > bedDepthArea || pso_poly.bounds.miny + shift_y < -bedDepthArea || pso_z + pso_surrogate.height > settings.device.bedDepth) {
                                    // console.log(pso_poly.bounds.maxx);
                                    // console.log(pso_poly.bounds.minx);
                                    // console.log(pso_poly.bounds.maxy);
                                    // console.log(pso_poly.bounds.miny);
                                    // console.log("eh");
                                    continue; // TODO: save for return later the negative size of overlap for this test part?
                                }
                            }



                            let rotation = chosen_rotation; 
                            
                            const sliceIndexList = getSliceIndexList(this.surrogate_settings.precomputed_slice_heights, pso_z, pso_z + pso_surrogate.minHeight)
                            let splitLists = reorderSliceIndexList(sliceIndexList, this.surrogate_settings.skimPercentage);
                            let quickList = splitLists[0];
                            let remainderList = splitLists[1];

                            // var_list[iteration_number*this.surrogate_settings.number_of_vars + 7] = 0;
                            // pso_use_this_surrogate = 0;

                            // let pso_collision_and_volumes = checkVolumeAndCollisions(this.surrogate_library, this.surrogate_settings, this.surrogate_settings.start_slice, library_index, pso_polygons_list, pso_z, all_surrogates);
                            let pso_collision_and_volumes = checkVolumeAndCollisionsListQuick(this.surrogate_settings.all_slices, quickList, sliceIndexList.length, pso_polygons_list, all_surrogates);
                            
                            // const delta_volume = pso_collision_and_volumes[1] - pso_collision_and_volumes[2];
                            let delta_volume_estimate = pso_collision_and_volumes[1];
                            if (pso_surrogate.type != "simpleRectangle") delta_volume_estimate = delta_volume_estimate * pso_surrogate.maxHeight / pso_surrogate.minHeight; // Stretch estimate to max height
                            if (delta_volume_estimate > this.surrogate_settings.minVolume) {
                                // console.log({delta_volume_estimate:delta_volume_estimate});
                                
                                // console.log({pso_collision_and_volumes:pso_collision_and_volumes});
                                if (pso_collision_and_volumes[0] === true) { // Collision in quick check found: Use estimate as collided area after reducing by overlap factor.
                                    // var_list[iteration_number*this.surrogate_settings.number_of_vars + 7] = 0;

                                    let overlap_factor = (pso_collision_and_volumes[2] / (pso_collision_and_volumes[4]));
                                    if (overlap_factor > 1 || isNaN(overlap_factor)) overlap_factor = 1.0;
                                    pso_collision_and_volumes[3] = delta_volume_estimate * (1-overlap_factor); // Scale estimate by collision severity
                                    // if (overlap_factor < smallest_overlap_factor) smallest_overlap_factor = overlap_factor;
                                    average_overlap_factor += overlap_factor;
                                    // overlap_counter += pso_collision_and_volumes[5];
                                    overlap_counter += 1;
                                }

                                else { // No collision yet
                                    // save successful candidate // TODO: (and validation insertion case and layer)
                                    // if (good_tower) console.log({Note:"Good tower and no collision YET"});

                                    if (delta_volume_estimate > (this.surrogate_settings.average_so_far * this.surrogate_settings.exploration_factor)) {

                                        let pso_collision_and_volumes_remaining = checkVolumeAndCollisionsRemaining(this.surrogate_settings.all_slices, remainderList, pso_polygons_list, all_surrogates);
                                        pso_collision_and_volumes[0] = pso_collision_and_volumes_remaining[0]; // Update collision status
                                
                                        
                                        let total_volume = pso_collision_and_volumes[3] + pso_collision_and_volumes_remaining[3];
                                        if (pso_collision_and_volumes_remaining[0] === true) { // Found collision in remaining layers
                                            // var_list[iteration_number*this.surrogate_settings.number_of_vars + 7] = 0; // Set to collision
                                            pso_use_this_surrogate = 0;
                                            // console.log({pso_collision_and_volumes_remaining:pso_collision_and_volumes_remaining});
                                            // console.log("Verify: " + pso_collision_and_volumes_remaining[2].toString());
                                            
                                            let overlap_factor = (pso_collision_and_volumes_remaining[2] / (pso_collision_and_volumes_remaining[4]));
                                            if (overlap_factor > 1 || isNaN(overlap_factor)) overlap_factor = 1.0;
                                            average_overlap_factor += overlap_factor;
                                            // overlap_counter += pso_collision_and_volumes_remaining[5];
                                            overlap_counter += 1;
                                            total_volume = ((total_volume / (pso_collision_and_volumes_remaining[6] + quickList.length)) * sliceIndexList.length) * (1-overlap_factor); // Update estimate and scale by collision severity

                                        }
                                        else {
                                            // var_list[iteration_number*this.surrogate_settings.number_of_vars + 7] = 1; // Set to no collision
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
                                            if (tower_library_index >= 0) {
                                                lower_surrogate.push(all_surrogates[tower_library_index]);
                                                // var_list[iteration_number*this.surrogate_settings.number_of_vars + 1] = chosen_x; // We moved the surrogate for the tower successfully
                                                // var_list[iteration_number*this.surrogate_settings.number_of_vars + 2] = chosen_y;
                                                // var_list[iteration_number*this.surrogate_settings.number_of_vars + 8] = chosen_x; // We moved the surrogate for the tower successfully
                                                // var_list[iteration_number*this.surrogate_settings.number_of_vars + 9] = chosen_y;
                                                tower_details.tower_x = chosen_x; // We moved the surrogate for the tower successfully
                                                tower_details.tower_y = chosen_y;
                                            }
                                            let end_height = finalHeight;
                                            let candidate = {
                                                geometry:pso_polygons_list, 
                                                rotation:rotation,
                                                surro:pso_surrogate, starting_height:pso_z, 
                                                end_height:end_height, 
                                                down_surrogate:lower_surrogate, 
                                                up_surrogate:empty_array, 
                                                outlines_drawn:0, 
                                                insertion_data:data_array
                                            };

                                            // check_surrogate_insertion_case(candidate, this.surrogate_settings.start_slice, this.surrogate_settings);
                                            simple_insertion_case_check(candidate, this.surrogate_settings.precomputed_slice_heights);
                                            // console.log({candidate_insertiondata:candidate.insertion_data});

                                            all_surrogates.push(candidate);
                                            new_surrogates.push(candidate);
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
                                if ((Math.random() < 0.2) && (pso_collision_and_volumes[0] == true) && (tower_library_index >= 0)) { // Encourage build plate exploration if bad tower
                                    var_list[iteration_number*this.surrogate_settings.number_of_vars + 3] = var_list[iteration_number*this.surrogate_settings.number_of_vars + 3] - 0.05; // = 0
                                } else if ((Math.random() < 0.05) && (pso_collision_and_volumes[0] == true) && (tower_library_index < 0)) { // Encourage tower exploration if bad build plate placement
                                    var_list[iteration_number*this.surrogate_settings.number_of_vars + 3] = var_list[iteration_number*this.surrogate_settings.number_of_vars + 3] + 0.05; // = Math.random()
                                }
                                else results_array.push(pso_collision_and_volumes);
                            }
                        }
                        // let current_details = [];
                        // for (let j = iteration_number*this.surrogate_settings.number_of_vars + 1; j < (1+iteration_number)*this.surrogate_settings.number_of_vars; j++) {
                        let current_details = [...var_list];
                        current_details = current_details.slice(iteration_number*this.surrogate_settings.number_of_vars + 1, (1+iteration_number)*this.surrogate_settings.number_of_vars + 1)
                        // let varlistcopy = [...var_list];
                        // console.log({copylist:varlistcopy, index:iteration_number, sliced_list:current_details});
                        // }
                        
                        results_meta_data.candidate_details.push({pso_details:current_details, use_me:pso_use_this_surrogate, tower_details:tower_details});
                    }

                    let valid_combination = true;
                    let total_surrogates_volume = this.surrogate_settings.fitness_offset;
                    let total_collided_surrogates_volume = 0;
                    let interaction_layer_set = new Set();
                    // let collision_area_estimate = 0;
                    // let surrogate_area_estimate = 0;
                    const number_of_surrogates = all_surrogates.length;
                    let good_surrogate_count = 0;

                    // console.log({results_array:results_array});

                    let highest_surrogate_volume = 0;

                    for (const result of results_array) {
                        if (result[0] === true) { // Collided surrogates
                            valid_combination = false;
                            // const delta_volume = result[1] - result[2];
                            total_collided_surrogates_volume += result[3];
                            // collision_area_estimate += result[2]; // Get overlap area estimate
                            // surrogate_area_estimate += result[4]; // Biggest sorrgated area
                        }
                        else { // Good surrogates
                            good_surrogate_count += 1;
                            // const delta_volume = result[1] - result[2];
                            total_surrogates_volume += result[3]; // Get surrogated volume
                            if (highest_surrogate_volume < result[3]) highest_surrogate_volume = result[3];
                        }
                        // let delta_volume = result[1] - result[2] + this.surrogate_settings.fitness_offset;
                    }

                    // const average_surrogates_volume = total_surrogates_volume / (good_surrogate_count);
                    const average_surrogates_volume = highest_surrogate_volume;
                    if (this.surrogate_settings.average_so_far < average_surrogates_volume) this.surrogate_settings.average_so_far = average_surrogates_volume;

                    for (const surrogate of all_surrogates) {
                        interaction_layer_set.add(surrogate.insertion_data.new_layer_index) // Get number of interaction layers // TODO: add extra interactions as penalty for difficult surrogates (bridges, stacks...)
                    }


                    // limit influence of collided volume result
                    // if (total_surrogates_volume > this.surrogate_settings.minVolume && total_collided_surrogates_volume > total_surrogates_volume) total_collided_surrogates_volume = total_surrogates_volume;

                    const number_of_interactions = interaction_layer_set.size;
                    let fitness = total_surrogates_volume*15;

                    // if (total_surrogates_volume > 0) {
                    //     // console.log({interaction_layer_set:interaction_layer_set});
                    //     // console.log({all_surrogates:all_surrogates});

                    //     // const w_pieces = 0.3;
                    //     // const w_interactions = 0.7;
                    //     // const surrogate_N_penalty_factor = 0;//0.8;
                    //     // const interaction_N_penalty_factor = 0;//0.35;

                    //     // // console.log({total_surrogates_volume:total_surrogates_volume});
                    //     // fitness = total_surrogates_volume / (w_pieces * Math.pow(number_of_surrogates, surrogate_N_penalty_factor) + w_interactions * Math.pow(number_of_interactions, interaction_N_penalty_factor));
                    // }
                    
                    // if (valid_combination) console.log({valid_combination:valid_combination});
                    // console.log({collision_area_estimate:collision_area_estimate});
                    // console.log({surrogate_area_estimate:surrogate_area_estimate});


                    let surrogates_placed_pso = 0;
                    for (let candidate_detail of results_meta_data.candidate_details) {
                    // for (let iteration_number = 0; iteration_number < this.surrogate_settings.searchspace_max_number_of_surrogates; iteration_number++) {
                        // if (var_list[iteration_number * this.surrogate_settings.number_of_vars + 7] > 0.999999 && var_list[iteration_number * this.surrogate_settings.number_of_vars + 7] < 1.000001) {// If surrogate was placed without problem by PSO
                        if (candidate_detail.use_me) { 
                            surrogates_placed_pso += 1;
                        }
                        // if (pso_use_this_surrogate == 1) {
                        //     surrogates_placed_pso += 1;
                        // }
                    }



                    if (valid_combination && surrogates_placed_pso > 0) {
                        // let current_answer = [...var_list];
                        // this.valid_answers.push(current_answer);
                        // valid_answers.push(current_answer);
                        results_meta_data.valid = true;
                    }

                    const w_pieces = 0.3;
                    const w_interactions = 0.7;
                    // const surrogate_N_penalty_factor = 0;//0.8;
                    // const interaction_N_penalty_factor = 0;//0.35;

                    // console.log({total_surrogates_fitness:total_surrogates_volume*15});
                    // console.log({total_collided_surrogates_volume:total_collided_surrogates_volume});
                    // console.log({fitness_added:fitness});
                    if (number_of_surrogates > 1 || number_of_interactions > 1) {
                        fitness = fitness / 
                                            (w_pieces * Math.pow(number_of_surrogates, this.surrogate_settings.surrogate_N_penalty_factor) + 
                                            w_interactions * Math.pow(number_of_interactions, this.surrogate_settings.interaction_N_penalty_factor));
                    }
                    // console.log({fitness_interaction_penalty:fitness});

                    fitness += total_collided_surrogates_volume;

                    if (average_overlap_factor > 0) average_overlap_factor = average_overlap_factor / overlap_counter;

                    // if (valid_combination === true && fitness > this.surrogate_settings.minVolume) {
                    if (total_surrogates_volume > this.surrogate_settings.minVolume) {
                        // console.log({Note:"Found one fitting surrogate"});
                        // console.log({total_surrogates_volume:total_surrogates_volume});
                        fitness += (this.surrogate_settings.total_surrogate_volume*2 + this.surrogate_settings.total_surrogate_volume*(1.0-average_overlap_factor));
                    } 
                    else if (total_collided_surrogates_volume > this.surrogate_settings.minVolume) {
                        fitness += (this.surrogate_settings.total_surrogate_volume*(1.0-average_overlap_factor));
                    }

                    // console.log({fitness_after_bonus:fitness});

                    // console.log({average_overlap_factor:average_overlap_factor});
                    
                    results_meta_data.fitness = fitness;
                    this.valid_answers.push(results_meta_data);
                    valid_answers.push(results_meta_data);

                    done(fitness);

                    // if (valid_combination === false && total_collided_surrogates_volume > 0) {
                    //     let overlap_factor = (collision_area_estimate / surrogate_area_estimate);
                    //     if (overlap_factor > 1) overlap_factor = 1.0;
                    //     // console.log({overlap_factor:pso_collision_and_volumes[3]});
                    //     // if (fitness > this.surrogate_settings.best_valid) fitness = this.surrogate_settings.best_valid;
                    //     total_collided_surrogates_volume = total_collided_surrogates_volume * (1.0-overlap_factor); // Reduce by overlap percentage
                    //     if (this.surrogate_settings.leniency >= 0) {
                    //         if (Math.random() >= this.surrogate_settings.leniency) {
                    //             // delta_volume = delta_volume * this.surrogate_settings.leniency;
                    //             fitness = fitness + (total_collided_surrogates_volume)*0.01
                    //             // console.log({fitness:fitness});
                    //             done(fitness); 
                    //         }
                    //         else {
                    //             fitness = fitness + (total_collided_surrogates_volume)*0.01
                    //             // console.log({fitness:fitness});
                    //             done(fitness);
                    //         }
                    //         // delta_volume = delta_volume * this.surrogate_settings.leniency;
                    //         // return delta_volume;
                    //     }
                    //     else {
                    //         // Doesn't happen yet. Restore negative numbers that describe overlap area
                    //         console.log({error:"Objective function: Should not have reached this"});
                    //     }
                    // } else {
                    //     // console.log({fitness:fitness});
                    //     done(fitness); 
                    // }
                }
            }, {
                async: true
            });

            let pso_variable_list = [
                { start: 0, end: surrogate_settings.searchspace_max_number_of_surrogates}// 0: Meta: # of surrogates to be placed
            ];

            for (let pso_variables_idx = 0; pso_variables_idx < surrogate_settings.searchspace_max_number_of_surrogates; pso_variables_idx += 1) {
                // Could give each block a yes/no variable instead of the meta-#-of-surrogates
                pso_variable_list.push({ start: min_x, end: max_x});    // 1: X position
                pso_variable_list.push({ start: min_y, end: max_y});    // 2: Y position
                pso_variable_list.push({ start: -1, end: 1});           // 3: Z index, mapped from 0-1 to integer (If there are two options (on buildplate or on one surrogate), <=0.5 is on buildplate, >0.5 is on surrogate) // Start from -1 to favor build plate
                pso_variable_list.push({ start: 0, end: 360});          // 4: Rotation in degrees
                // Z height from 0 to model_height for bridge surrogates
                // yes/no switch between index-height and absolute-height method
                // pso_variable_list.push({ start: 0, end: optimizer.surrogate_library.length}); 
                                                                        // 5: Which surrogate was placed: library index, mapped from 0 to library_length

                pso_variable_list.push({ start: surrogate_settings.smallest_length, end: surrogate_settings.biggest_length});  // 5: Desired length of ideal surrogate, mapped from smallest to biggest available lengths                                                   
                pso_variable_list.push({ start: surrogate_settings.smallest_width, end: surrogate_settings.biggest_width});  // 6 {10}: Desired length of ideal surrogate, mapped from smallest to biggest available lengths                                                   
                pso_variable_list.push({ start: surrogate_settings.smallest_height, end: surrogate_settings.biggest_height});  // 7 {11}: Desired length of ideal surrogate, mapped from smallest to biggest available lengths                                                   
                // pso_variable_list.push({ start: 0, end: 1});            // 6: Target extension for height-varying surrogates, 0 = min_height, 1 = max_height
                // pso_variable_list.push({ start: 0, end: 0});            // 7: local meta variable: if this surrogate data should be used or not
                // pso_variable_list.push({ start: 0, end: 0});            // 8: local meta variable: Post-tower X position
                // pso_variable_list.push({ start: 0, end: 0});            // 9: local meta variable: Post-tower Y position
               
            }


            // set an initial population of 20 particles spread across the search space *[-10, 10] x [-10, 10]*
            optimizer.init(surrogate_settings.numberOfParticles, pso_variable_list);

            console.log({optimizer_after_init2:optimizer._particles});
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

            var iterations = 0, maxIterations = 100;
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
        

            if (surrogate_number_goal > 0) {
                log('Starting optimizer');
                loop();

                // print the best found fitness value and position in the search space
                console.log(optimizer.getBestFitness(), optimizer.getBestPosition());
                // Optimizer area ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

                let pso_position_vars = optimizer.getBestPosition();

                console.log({all_valid_answers_found:optimizer.valid_answers});
                console.log({all_valid_answers_found_global:valid_answers});

                let best_result = getBestResult(optimizer.valid_answers);
                console.log({best_result:best_result});


                let counter = 0;

                // for (let pso_result_surrogate_index = 0; pso_result_surrogate_index < surrogate_settings.searchspace_max_number_of_surrogates; pso_result_surrogate_index++) {
                for (let candidate_detail of best_result.candidate_details) {
                    // console.log({number_in_array:pso_result_surrogate_index * surrogate_settings.number_of_vars + 7});
                    // console.log(pso_position_vars[pso_result_surrogate_index * surrogate_settings.number_of_vars + 7]);
                    // console.log({candidate_number:pso_result_surrogate_index, useOrIgnore:valid_answers[pso_result_surrogate_index].use}); // Faulty?? valid answers is all answers, not just the best/last?
                    counter++;
                    console.log({candidate_number:counter, useOrIgnore:candidate_detail.use_me});
                    // if (pso_position_vars[pso_result_surrogate_index * surrogate_settings.number_of_vars + 7] > 0.999999 && pso_position_vars[pso_result_surrogate_index * surrogate_settings.number_of_vars + 7] < 1.000001) {// If surrogate was placed without problem by PSO
                    if (candidate_detail.use_me) { // If surrogate was placed without problem by PSO
                    // if (pso_use_this_surrogate == 1) {// If surrogate was placed without problem by PSO
                        // try_x = pso_position_vars[pso_result_surrogate_index * surrogate_settings.number_of_vars + 1];
                        try_x = candidate_detail.pso_details[0];
                        // try_y = pso_position_vars[pso_result_surrogate_index * surrogate_settings.number_of_vars + 2];
                        try_y = candidate_detail.pso_details[1];
                        // try_rotation = pso_position_vars[pso_result_surrogate_index * surrogate_settings.number_of_vars + 4];
                        try_rotation = candidate_detail.pso_details[3];

                        // let pso_desired_length = pso_position_vars[pso_result_surrogate_index * surrogate_settings.number_of_vars + 5];
                        let pso_desired_length = candidate_detail.pso_details[4];
                        // let pso_desired_width = pso_position_vars[pso_result_surrogate_index * surrogate_settings.number_of_vars + 10];
                        let pso_desired_width = candidate_detail.pso_details[5];
                        // let pso_desired_height = pso_position_vars[pso_result_surrogate_index * surrogate_settings.number_of_vars + 11];
                        let pso_desired_height = candidate_detail.pso_details[6];

                        try_surro = getBestFittingSurrogateL2(surros, pso_desired_length, pso_desired_width, pso_desired_height);

                        // // Select chosen surrogate
                        // let pso_chosen_surro = Math.floor(pso_position_vars[pso_result_surrogate_index * surrogate_settings.number_of_vars + 5]);
                        // if (pso_chosen_surro >= surros.length) {
                        //     pso_chosen_surro = surros.length-1; // Probably unnecessary with bounce
                        //     console.log({WARNING:"outside (above) of bounce range"});
                        // }
                        // else if (pso_chosen_surro < 0) {
                        //     pso_chosen_surro = 0;
                        //     console.log({WARNING:"outside (below) of bounce range"});
                        // }

                        // try_surro = surros[pso_chosen_surro];

                        // Select test tower position/on baseplate
                        let tower_library_float = candidate_detail.pso_details[2];
                        try_z = 0;
                        let tower_library_index = -1;
                        if (surrogate_settings.allow_towers == true) {
                            if (tower_library_float >= 1) {
                                tower_library_index = 0.99999;
                            }
                            else if (tower_library_float < 0) {
                                tower_library_index = 0;
                            } else tower_library_index = tower_library_float;

                            tower_library_index = Math.floor(tower_library_index * (surrogates_placed.length+1)); // #previous surrogates + 1 for on-baseplate
                            tower_library_index = tower_library_index - 1; 

                            // if (tower_library_index >= 0) try_z = surrogates_placed[tower_library_index].starting_height + surrogates_placed[tower_library_index].surro.height;
                            if (tower_library_index >= 0) try_z = surrogates_placed[tower_library_index].end_height;
                        }
        

                        // Adjust position/rotation to lower surrogate in tower
                        if (tower_library_index >= 0) {
                            // let x_space = (surrogates_placed[tower_library_index].surro.length - try_surro.length - 1.6) * 0.5; // TODO: Set to two times nozzle size
                            // let y_space = (surrogates_placed[tower_library_index].surro.width - try_surro.width - 1.6) * 0.5;
                            try_rotation = surrogates_placed[tower_library_index].rotation;
                            // try_x = pso_position_vars[pso_result_surrogate_index * surrogate_settings.number_of_vars + 8];
                            // try_y = pso_position_vars[pso_result_surrogate_index * surrogate_settings.number_of_vars + 9];
                            try_x = TODOobject.tower_details.tower_x;
                            try_y = TODOobject.tower_details.tower_y;
                            // let mid_x = (surrogates_placed[tower_library_index].geometry[0].bounds.maxx + surrogates_placed[tower_library_index].geometry[0].bounds.minx)*0.5;
                            // let mid_y = (surrogates_placed[tower_library_index].geometry[0].bounds.maxy + surrogates_placed[tower_library_index].geometry[0].bounds.miny)*0.5
                            // if (try_x > mid_x + x_space) try_x = mid_x + x_space;
                            // else if (try_x < mid_x - x_space) try_x = mid_x - x_space;
                            // if (try_y > mid_y + y_space) try_y = mid_y + y_space;
                            // else if (try_y < mid_y - y_space) try_y = mid_y - y_space;
                        } 


                        // Check if surrogate is available
                        if (try_surro.available === false) {
                            console.log({Warning_note:"A surro has been chosen that was not available."});
                        }

                        let pso_polygons_list = [];
                        let prism_bottoms = [];
                        let finalHeight = try_z + try_surro.height;
                        let id_extension;
                        if (try_surro.type == "simpleRectangle") {
                            pso_polygons_list = [generateRectanglePolygonCentered(try_x, try_y, try_z, try_surro.length, try_surro.width, try_rotation, surrogate_settings.surrogate_padding, bottom_slice)];
                        }
                        else if (try_surro.type == "prism") {
                            pso_polygons_list = [generatePrismPolygon(try_x, try_y, try_z, try_surro.prism_geometry, try_rotation, surrogate_settings.surrogate_padding, bottom_slice)];
                            // const deg = try_rotation * Math.PI / 180;
                            // const alignX = Math.cos(deg)*5 - Math.sin(deg)*5;
                            // const alignY = Math.sin(deg)*5 + Math.cos(deg)*5;
                            // const alignX = 0; const alignY = 0;
                            prism_bottoms = [generatePrismPolygon(try_x, try_y, try_z, try_surro.bottom_geometry, try_rotation, surrogate_settings.surrogate_padding, bottom_slice)]; // TODO align these using SVG viewbox
                            const extensionIndexList = getSliceIndexList(surrogate_settings.precomputed_slice_heights, try_z + try_surro.minHeight, try_z + try_surro.maxHeight);
                            const extensionData = checkVolumeAndCollisionsExtend(surrogate_settings.all_slices, extensionIndexList, pso_polygons_list, finalHeight);
                            finalHeight = extensionData[0];
                        } else {
                            pso_polygons_list = [generateRectanglePolygonCentered(try_x, try_y, try_z, try_surro.length, try_surro.width, try_rotation, surrogate_settings.surrogate_padding, bottom_slice)];
                            const stackIndexList = getStackableIndexList(surrogate_settings.precomputed_slice_heights, try_z + try_surro.minHeight, try_surro.addMaxNumber, try_surro.addHeight);
                            const stackingData = checkVolumeAndCollisionsStack(surrogate_settings.all_slices, stackIndexList, pso_polygons_list, finalHeight, try_surro.addHeight);
                            finalHeight = stackingData[0];
                            id_extension = stackingData[2];
                        }

                        // generate candidate and validation insertion case and layer
                        let lower_surro = [];
                        let empty_array = [];
                        let data_array = {insertion_case:"unknown"};
                        if (tower_library_index >= 0) {
                            lower_surro.push(surrogates_placed[tower_library_index]);
                        }
                        let end_height = finalHeight;
                        console.log({try_z:try_z});
                        console.log({finalHeight:finalHeight});
                        let candidate = {
                            geometry:pso_polygons_list, 
                            rotation:try_rotation,
                            surro:try_surro, starting_height:try_z, 
                            end_height:end_height, 
                            down_surrogate:lower_surro, 
                            up_surrogate:empty_array, 
                            outlines_drawn:0, 
                            insertion_data:data_array,
                            bottom_geometry:prism_bottoms,
                            id_extension:id_extension
                        };

                        if (tower_library_index >= 0) {
                            surrogates_placed[tower_library_index].up_surrogate.push(candidate); // Add backwards reference for tower
                        }


                        // Rotation debug testing
                        for (let debugint = 1; debugint < 2; debugint = debugint + 85) {
                            continue;
                            // let trysurrorandom = surros[Math.floor(Math.random() * surros.length)];
                            // console.log({trysurrorandom:trysurrorandom});
                            // let pso_polygons_listDB = [generateRectanglePolygonCentered(try_x, try_y, up.z, trysurrorandom.length, trysurrorandom.width, debugint, surrogate_settings.surrogate_padding, bottom_slice)];
                            // let pso_polygons_listDB = [generateRectanglePolygonCentered(try_x, try_y, up.z, try_surro.length, try_surro.width, debugint, surrogate_settings.surrogate_padding, bottom_slice)];

                            // console.log({try_x:try_x});
                            // console.log({boundmid:(candidate.geometry[0].bounds.maxx + candidate.geometry[0].bounds.minx)*0.5});

                            // let testLength = 10;
                            // let testWidth = 5;

                            // let x_space = (try_surro.length - testLength)*0.5;
                            // let y_space = (try_surro.width - testWidth)*0.5;

                            // let targetX = Math.random()*200-100;
                            // let targetY = Math.random()*200-100;

                            // let degRot = try_rotation * Math.PI / 180;
                            // let x_dist = targetX - try_x;
                            // let y_dist = targetY - try_y;

                            // // x_dist = 10;
                            // // y_dist = 0;

                            // let local_x_dist = Math.cos(degRot)*x_dist + Math.sin(degRot)*y_dist;
                            // let local_y_dist = -1*Math.sin(degRot)*x_dist + Math.cos(degRot)*y_dist;

                            

                            // // local_x_dist = 10;
                            // // local_y_dist = 7;

                            // if (local_x_dist > x_space) local_x_dist = x_space;
                            // else if (local_x_dist < -x_space) local_x_dist = -x_space;
                            // // else local_x_dist = 0;

                            // if (local_y_dist > y_space) local_y_dist = y_space;
                            // else if (local_y_dist < -y_space) local_y_dist = -y_space;
                            // // else local_x_dist = 0;

                            // let global_x_dist = Math.cos(degRot)*local_x_dist - Math.sin(degRot)*local_y_dist;
                            // let global_y_dist = Math.sin(degRot)*local_x_dist + Math.cos(degRot)*local_y_dist;

                            // let baseXAfter = try_x + global_x_dist;
                            // let baseYAfter = try_y + global_y_dist;


                            // let pso_polygons_listDB = [generatePrismPolygon(try_x, try_y, up.z, prisms[0].geometry_points, debugint, surrogate_settings.surrogate_padding, bottom_slice)];
                            // let pso_polygons_listDB2 = [generateRectanglePolygonCentered(baseXAfter, baseYAfter, up.z, testLength, testWidth, try_rotation, surrogate_settings.surrogate_padding, bottom_slice)];
                            // let candidateDB2 = {
                            //     geometry:pso_polygons_listDB2, 
                            //     rotation:try_rotation,
                            //     surro:try_surro, 
                            //     // surro:trysurrorandom, 
                            //     starting_height:try_z, 
                            //     end_height:end_height, 
                            //     down_surrogate:lower_surro, 
                            //     up_surrogate:empty_array, 
                            //     outlines_drawn:0, 
                            //     insertion_data:data_array
                            // };

                            // surrogates_placed.push(candidateDB2);
                            
                            // let pso_polygons_listDB = [generatePrismPolygon(try_x+debugint*3, try_y, up.z, try_surro.geometry, debugint, surrogate_settings.surrogate_padding, bottom_slice)];
                            let pso_polygons_listDB = [generateRectanglePolygonCentered(0, 0, up.z, bedWidthArea*2, bedDepthArea*2, 0, surrogate_settings.surrogate_padding, bottom_slice)];

                            // const alignX = 0; const alignY = 0;
                            // prism_bottoms = [generatePrismPolygon(try_x+debugint*3, try_y, try_z, try_surro.bottom_geometry, debugint, surrogate_settings.surrogate_padding, bottom_slice)]; // TODO align these using SVG viewbox

                            let candidateDB = {
                                geometry:pso_polygons_listDB, 
                                rotation:debugint,
                                surro:try_surro, 
                                // surro:trysurrorandom, 
                                starting_height:try_z, 
                                end_height:end_height, 
                                down_surrogate:lower_surro, 
                                up_surrogate:empty_array, 
                                outlines_drawn:0, 
                                insertion_data:data_array,
                                bottom_geometry:prism_bottoms
                            };

                            surrogates_placed.push(candidateDB);
                        }



                        // console.log({candidate:candidate});
                        check_surrogate_insertion_case(candidate, bottom_slice, surrogate_settings);

                        // Check if it is on a consecutive layer from a previous surrogate
                        let consecutive = false;
                        surrogates_placed.forEach(function(surrogate) {
                            if (Math.abs(candidate.insertion_data.index - surrogate.insertion_data.index) === 1) {
                                consecutive = true;
                            }
                        });
                        if (consecutive) {
                            // good = false;
                            // repetition_counter++;
                            // continue;
                            console.log({Warning_note:"Two surrogates placed on conecutive layers."})
                        }

                        surrogates_placed.push(candidate);
                        candidate.surro.available = false; // Mark surro as used
        
                        console.log({placed_surro_name:candidate.surro.id});

                    }
                }
                
                if (surrogates_placed.length > 0) {
                    // TODO: Error handling for no surros?
                }

            }
        }


        // All surrogates have been placed now 





        console.log({surrogates_placed:surrogates_placed});



        // Remove supports based on surrogates placed
        up = bottom_slice;
        let top_slice = bottom_slice;
        // For all slices
        if (surrogate_number_goal > 0) {
            while (up) {

                

                // If supports exist
                if (up.supports && up.supports.length > 0) {

                    // if (!up.tops[0].fill_sparse) up.tops[0].fill_sparse = [];
                    // let rand_supp = up.supports[Math.floor(Math.random() * up.supports.length)];
                    // up.tops[0].fill_sparse.push(rand_supp);

                    // For every surro, surrogate the support
                    for (let idx = 0; idx < surrogates_placed.length; idx++) {
                        let surrogate = surrogates_placed[idx];
                        
                        if (surrogate.insertion_data.insertion_case === "Insert_new_support_layer") {
                            let up_height_range = get_height_range(up);
                            // (surrogate.surro.height + surrogate.starting_height)
                            if (up_height_range.bottom_height < (surrogate.end_height) && up.z >= surrogate.starting_height) {
                                let surrogated_supports = [];
                                POLY.subtract(up.supports, surrogate.geometry, surrogated_supports, null, up.z, min); // TODO: Collect surro polygons and do it only once
                                up.supports = surrogated_supports;
                            }
                        }
                        // If the surro is at this height
                        // (surrogate.surro.height + surrogate.starting_height)
                        else if (up.z < (surrogate.end_height) && up.z >= surrogate.starting_height) {
                            let surrogated_supports = [];
                            POLY.subtract(up.supports, surrogate.geometry, surrogated_supports, null, up.z, min); // TODO: Collect surro polygons and do it only once
                            up.supports = surrogated_supports;
                        }
                    }
                } else {
                    up.supports = [];
                }

                // After surrogating all supports, draw their outlines
                for (let draw_outline_idx = 0; draw_outline_idx < surrogates_placed.length; draw_outline_idx++) {
                    let surrogate = surrogates_placed[draw_outline_idx];
                    // If the surro is at this height
                    if (up.z < (surrogate.end_height) && up.z >= surrogate.starting_height) {
                        if (surrogate.outlines_drawn < 5) {

                            let geometry_to_use;
                            if (surrogate.surro.type == "prism") geometry_to_use = surrogate.bottom_geometry;
                            else geometry_to_use = surrogate.geometry;

                            // make surrogate bigger
                            // let surrogate_enlarged_more = [];
                            // let surrogate_enlarged = [];
                            // surrogate_enlarged_more = POLY.expand(surrogate.geometry, 0.4 + surrogate_enlargement, up.z, surrogate_enlarged_more, 1); // For a less tight fit
                            // surrogate_enlarged = POLY.expand(surrogate.geometry, surrogate_enlargement, up.z, surrogate_enlarged, 1); // For a less tight fit
                            let surrogate_enlarged = [];
                            let surrogate_double_enlarged = [];
                            surrogate_enlarged = POLY.expand(geometry_to_use, 0.4, up.z, surrogate_enlarged, 1);
                            surrogate_double_enlarged = POLY.expand(surrogate_enlarged, 0.4, up.z, surrogate_double_enlarged, 1); 

                            
                            // subtract actual surrogate area to get only the outline
                            let surrogate_outline_area_only = [];
                            // POLY.subtract(surrogate_enlarged_more, surrogate_enlarged, surrogate_outline_area_only, null, up.z, min);
                            POLY.subtract(surrogate_enlarged, geometry_to_use, surrogate_outline_area_only, null, up.z, min);

                            // surrogate_outline_area_only[0].points.forEach(function (point) {
                            //     point.z = point.z + 3.667686;
                            // });

                            // console.log({next_layer:up.up});
                            // Add outline to supports (will still be a double outline for now)
                            if (false) {
                            //if (!first_placed) { // Switch mode for first outline
                                up.tops[0].shells.push(surrogate_outline_area_only[0]);
                                first_placed = true;
                            } else {
                                //up.supports.push(surrogate_outline_area_only[0]);
                                if (!(up.tops[0].fill_sparse)) {
                                    up.tops[0].fill_sparse = [];
                                }
                                if (!(up.virtual_support)) {
                                    up.virtual_support = [];
                                } 
                                surrogate_outline_area_only[0].points.push(surrogate_outline_area_only[0].points[0]);
                                // console.log({points_poly:surrogate_outline_area_only[0]});
                                // up.tops[0].fill_sparse.push(surrogate_outline_area_only[0]);
                                up.tops[0].fill_sparse.push(surrogate_outline_area_only[0]);
                                up.tops[0].fill_sparse.push(surrogate_outline_area_only[0]);
                                up.virtual_support.push(surrogate_outline_area_only[0]);
                                
                                let supp_minus_outlines = [];

                                if (surrogate.outlines_drawn < 1 && surrogate.surro.type == "prism") {
                                    let surrogate_enlarged2 = [];
                                    let surrogate_double_enlarged2 = [];
                                    surrogate_enlarged2 = POLY.expand(surrogate.geometry, 0.4, up.z, surrogate_enlarged2, 1);
                                    surrogate_double_enlarged2 = POLY.expand(surrogate_enlarged, 0.4, up.z, surrogate_double_enlarged2, 1); 
                                    let surrogate_outline_area_only2 = [];
                                    // POLY.subtract(surrogate_enlarged_more, surrogate_enlarged, surrogate_outline_area_only, null, up.z, min);
                                    POLY.subtract(surrogate_enlarged2, surrogate.geometry, surrogate_outline_area_only2, null, up.z, min);
                                    surrogate_outline_area_only2[0].points.push(surrogate_outline_area_only2[0].points[0]);
                                    up.tops[0].fill_sparse.push(surrogate_outline_area_only2[0]);
                                    up.tops[0].fill_sparse.push(surrogate_outline_area_only2[0]);
                                    up.virtual_support.push(surrogate_outline_area_only2[0]);
                                }

                                // Prevent overlap of outlines and support // LWW TODO: Try adding to support and combine the two
                                up.supports = POLY.subtract(up.supports, surrogate_double_enlarged, supp_minus_outlines, null, up.z, min);


                                surrogate.text_posX = (surrogate_outline_area_only[0].bounds.maxx + surrogate_outline_area_only[0].bounds.minx)/2;
                                surrogate.text_posY = (surrogate_outline_area_only[0].bounds.maxy + surrogate_outline_area_only[0].bounds.miny)/2;

                                if (false)
                                if (surrogate.outlines_drawn < 1) {
                                    let text_rotation = surrogate.rotation;
                                    let out_rotation = text_rotation;
                                    let text_rot_ang;
                                    
                                    // console.log({surrogate_outline_area_only:surrogate_outline_area_only});
                                    // let text_posX = surrogate_outline_area_only[0].points[0].x;
                                    // let text_posY = surrogate_outline_area_only[0].points[0].y;
                                    let text_posX = (surrogate_outline_area_only[0].bounds.maxx + surrogate_outline_area_only[0].bounds.minx)/2;
                                    let text_posY = (surrogate_outline_area_only[0].bounds.maxy + surrogate_outline_area_only[0].bounds.miny)/2;
                                    let text_posX_alt = (surrogate_outline_area_only[0].bounds.maxx + surrogate_outline_area_only[0].bounds.minx)/2;
                                    let text_posY_alt = (surrogate_outline_area_only[0].bounds.maxy + surrogate_outline_area_only[0].bounds.miny)/2;
                                    // console.log({surrogate_text_drawing:surrogate});
                                    // let text_posX = surrogate.geometry[0].points[0].x;
                                    // let text_posY = surrogate.geometry[0].points[0].y;
                                    
                                    if (surrogate.surro.type == "prismNOO") {
                                        console.log({surrogate_enlarged_bounds:surrogate_outline_area_only[0].bounds});
                                        console.log({outline_points:surrogate_outline_area_only[0]});
                                        // text_posX = surrogate_outline_area_only[0].bounds.minx;
                                        // text_posY = surrogate_outline_area_only[0].bounds.miny;
                                        text_posX = surrogate_outline_area_only[0].points[0].x;
                                        text_posY = surrogate_outline_area_only[0].points[0].y;
                                    }
                                    // console.log({text_posX:text_posX});
                                    // console.log({text_posY:text_posY});


                                    surrogate.text_posX = text_posX;
                                    surrogate.text_posY = text_posY;
                                    // console.log({text_rotation:text_rotation});
                                    text_rotation = text_rotation % 360; // Rotate until within 360°
                                    // Rotate values below 0 by one full rotation
                                    if (text_rotation <= 0) {
                                        text_rotation = text_rotation + 360;
                                    }

                                    let topOrBottom = true;

                                    
                                    if (surrogate.surro.type != "prism") { 
                                        // if (text_rotation > 0 && text_rotation <= 90) { // Top-right
                                        //     out_rotation = text_rotation;
                                        //     text_rot_ang = text_rotation * Math.PI / 180;
                                        //     // text_posX = text_posX - Math.cos(text_rot_ang)*surrogate.surro.length - Math.sin(-text_rot_ang)*(surrogate.surro.width+3)*-1;
                                        //     // text_posY = text_posY - Math.sin(text_rot_ang)*surrogate.surro.length - Math.cos(text_rot_ang)*(surrogate.surro.width+3)*-1;
                                        //     // text_posX = text_posX - Math.cos(text_rot_ang)*surrogate.surro.length*0.5 - Math.sin(-text_rot_ang)*(-surrogate.surro.width*0.5-2);
                                        //     // text_posY = text_posY - Math.sin(text_rot_ang)*surrogate.surro.length*0.5 - Math.cos(text_rot_ang)*(-surrogate.surro.width*0.5-2);
                                        //     // text_posX = text_posX - Math.sin(text_rot_ang)*0 - Math.sin(-text_rot_ang)*(0);
                                        //     // text_posY = text_posY - Math.sin(text_rot_ang)*0 - Math.cos(text_rot_ang)*(0);
                                        // }
                                        if (text_rotation > 90 && text_rotation <= 270) { // Top-left + Bottom Left --> Flip text
                                            out_rotation = text_rotation + 180;
                                            // text_rot_ang = out_rotation * Math.PI / 180;
                                            // text_posX = text_posX - Math.cos(text_rot_ang)*surrogate.surro.length*0.5 - Math.sin(-text_rot_ang)*(-surrogate.surro.width*0.5-2);
                                            // text_posY = text_posY - Math.sin(text_rot_ang)*surrogate.surro.length*0.5 - Math.cos(text_rot_ang)*(-surrogate.surro.width*0.5-2);
                                        } else {
                                            // out_rotation = text_rotation;
                                            
                                        }
                                        // else if (text_rotation > 180 && text_rotation <= 270) { // Bottom-left
                                        //     out_rotation = text_rotation + 180;
                                        //     text_rot_ang = out_rotation * Math.PI / 180;
                                        //     // text_posX = text_posX - Math.cos(text_rot_ang)*(surrogate.surro.id.length*char_size) - Math.sin(-text_rot_ang)*(7);
                                        //     // text_posY = text_posY - Math.sin(text_rot_ang)*(surrogate.surro.id.length*char_size) - Math.cos(text_rot_ang)*(7);
                                        //     // text_posX = text_posX - Math.cos(text_rot_ang)*(surrogate.surro.length*0.5) - Math.sin(-text_rot_ang)*(-surrogate.surro.width*0.5-2);
                                        //     // text_posY = text_posY - Math.sin(text_rot_ang)*(surrogate.surro.length*0.5) - Math.cos(text_rot_ang)*(-surrogate.surro.width*0.5-2);
                                        // }
                                        // else if (text_rotation > 270 && text_rotation <= 360) { // Bottom-right
                                        //     out_rotation = text_rotation;
                                        //     text_rot_ang = out_rotation * Math.PI / 180;
                                        //     // text_posX = text_posX - Math.cos(text_rot_ang)*(surrogate.surro.length*0.5) - Math.sin(-text_rot_ang)*(-surrogate.surro.width*0.5-2);
                                        //     // text_posY = text_posY - Math.sin(text_rot_ang)*(surrogate.surro.length*0.5) - Math.cos(text_rot_ang)*(-surrogate.surro.width*0.5-2);
                                        //     // text_posX = text_posX - Math.cos(text_rot_ang)*(surrogate.surro.length) - Math.sin(-text_rot_ang)*(-2);
                                        //     // text_posY = text_posY - Math.sin(text_rot_ang)*(surrogate.surro.length) - Math.cos(text_rot_ang)*(-2);
                                        // } else {
                                        //     console.log({WARNING:"Warning: text rotation out of handled range"});
                                        // }
                                        text_rot_ang = out_rotation * Math.PI / 180;
                                        text_posX = text_posX - Math.cos(text_rot_ang)*surrogate.surro.length*0.5 + Math.sin(text_rot_ang)*(-surrogate.surro.width*0.5-3); // sin angle was minus, but also minus the whole term
                                        text_posY = text_posY - Math.sin(text_rot_ang)*surrogate.surro.length*0.5 - Math.cos(text_rot_ang)*(-surrogate.surro.width*0.5-3);

                                        // text_posX_alt = text_posX_alt - Math.cos(text_rot_ang)*(-surrogate.surro.length*0.5+(surrogate.surro.id.length*char_size*1.1)) + Math.sin(text_rot_ang)*(surrogate.surro.width*0.5+char_size+3);
                                        // text_posY_alt = text_posY_alt - Math.sin(text_rot_ang)*(-surrogate.surro.length*0.5+(surrogate.surro.id.length*char_size*1.1)) - Math.cos(text_rot_ang)*(surrogate.surro.width*0.5+char_size+3);
                                        text_posX_alt = text_posX_alt - Math.cos(text_rot_ang)*(surrogate.surro.length*0.5) + Math.sin(text_rot_ang)*(surrogate.surro.width*0.5+char_size+3);
                                        text_posY_alt = text_posY_alt - Math.sin(text_rot_ang)*(surrogate.surro.length*0.5) - Math.cos(text_rot_ang)*(surrogate.surro.width*0.5+char_size+3);


                                        let textOption1 = newPoint(text_posX, text_posY, 0.0);
                                        let textOption2 = newPoint(text_posX_alt, text_posY_alt, 0.0);
                                        let midPoint = newPoint(0.0, 0.0, 0.0);


                                        if (midPoint.distTo2D(textOption1) < midPoint.distTo2D(textOption2)) {
                                            text_posX = text_posX_alt;
                                            text_posY = text_posY_alt;
                                            topOrBottom = false;
                                        }

                                        

                                        console.log({Dist1:midPoint.distTo2D(textOption1)});
                                        console.log({Dist2:midPoint.distTo2D(textOption2)});

                                    }
                                    else {
                                        const length = surrogate.geometry[0].bounds.maxx - surrogate.geometry[0].bounds.minx;
                                        const width = surrogate.geometry[0].bounds.maxy - surrogate.geometry[0].bounds.miny;
                                        // const length = surrogate.surro.length;
                                        // const width = surrogate.surro.width;
                                        if (text_rotation > 0 && text_rotation <= 90) { // Top-right
                                            text_rot_ang = text_rotation * Math.PI / 180;
                                            out_rotation = text_rotation;
                                            text_posX = text_posX - Math.cos(text_rot_ang)*length*0.5 - Math.sin(-text_rot_ang)*(-width*0.5-2);
                                            text_posY = text_posY - Math.sin(text_rot_ang)*length*0.5 - Math.cos(text_rot_ang)*(-width*0.5-2);

                                            const angle_compensation = 45 - Math.abs((out_rotation % 90)-45);
                                            text_posX = text_posX - Math.sin(-text_rot_ang)*(angle_compensation*0.13);
                                            text_posY = text_posY - Math.cos(text_rot_ang)*(angle_compensation*0.13);

                                        }
                                        else if (text_rotation > 90 && text_rotation <= 180) { // Top-left
                                            out_rotation = text_rotation + 180;
                                            text_rot_ang = out_rotation * Math.PI / 180;
                                            text_posX = text_posX - Math.cos(text_rot_ang)*length*0.5 - Math.sin(-text_rot_ang)*(-width*0.5-2);
                                            text_posY = text_posY - Math.sin(text_rot_ang)*length*0.5 - Math.cos(text_rot_ang)*(-width*0.5-2);
                                        }
                                        else if (text_rotation > 180 && text_rotation <= 270) { // Bottom-left
                                            out_rotation = text_rotation + 180;
                                            text_rot_ang = out_rotation * Math.PI / 180;
                                            text_posX = text_posX - Math.cos(text_rot_ang)*length*0.5 - Math.sin(-text_rot_ang)*(-width*0.5);
                                            text_posY = text_posY - Math.sin(text_rot_ang)*length*0.5 - Math.cos(text_rot_ang)*(-width*0.5);

                                            const angle_compensation = 45 - Math.abs((out_rotation % 90)-45);
                                            text_posX = text_posX - Math.sin(-text_rot_ang)*(-angle_compensation*0.05);
                                            text_posY = text_posY - Math.cos(text_rot_ang)*(-angle_compensation*0.05);
                                        }
                                        else if (text_rotation > 270 && text_rotation <= 360) { // Bottom-right
                                            out_rotation = text_rotation;
                                            text_rot_ang = out_rotation * Math.PI / 180;
                                            text_posX = text_posX - Math.cos(text_rot_ang)*length*0.5 - Math.sin(-text_rot_ang)*(-width*0.5-2);
                                            text_posY = text_posY - Math.sin(text_rot_ang)*length*0.5 - Math.cos(text_rot_ang)*(-width*0.5-2);
                                            const angle_compensation = 45 - Math.abs((out_rotation % 90)-45);
                                            text_posX = text_posX - Math.sin(-text_rot_ang)*(angle_compensation*0.13);
                                            text_posY = text_posY - Math.cos(text_rot_ang)*(angle_compensation*0.13);
                                        } else {
                                            console.log({WARNING:"Warning: text rotation out of handled range"});
                                        }

                                        
                                    }

                                    // if (surrogate.surro.type == "prism") {
                                    //     if (text_rotation > 0 && text_rotation <= 90) {
                                    //         text_posX = text_posX - Math.sin(-text_rot_ang)*-3;
                                    //         text_posY = text_posY - Math.cos(text_rot_ang)*-3;
                                    //     } else if (text_rotation > 90 && text_rotation <= 180) {
                                    //         text_posX = text_posX - Math.sin(-text_rot_ang)*-5;
                                    //         text_posY = text_posY - Math.cos(text_rot_ang)*-5;
                                    //     } else if (text_rotation > 180 && text_rotation <= 270) {
                                    //         text_posX = text_posX - Math.sin(-text_rot_ang)*-3;
                                    //         text_posY = text_posY - Math.cos(text_rot_ang)*-3;
                                    //     } else  {
                                    //     }
                                    // }


                                
                                    // console.log({text_posX:text_posX});
                                    // console.log({text_posY:text_posY});
                                    // console.log({surrogate_posX:surrogate.text_posX});
                                    // console.log({surrogate_posY:surrogate.text_posY});


                                    // let ascii_poly_list = generateAsciiPolygons(surrogate.surro.id, surrogate_outline_area_only[0].points[0].x, surrogate_outline_area_only[0].points[0].y, surrogate.rotation);
                                    let ascii_poly_list2 = generateAsciiPolygons(surrogate.surro.id, text_posX, text_posY, out_rotation, surrogate_settings.text_size);
                                    // let ascii_poly_list3 = generateAsciiPolygons(surrogate.surro.id, text_posX_alt, text_posY_alt, out_rotation, surrogate_settings.text_size);

                                    
                                    

                                    // console.log({surrogate_rotation:surrogate.rotation});
                                    // console.log({ascii_poly_list:ascii_poly_list});
                                    // for (let ascii_poly of ascii_poly_list) up.tops[0].fill_sparse.push(ascii_poly);
                                    for (let ascii_poly of ascii_poly_list2)  {
                                        up.tops[0].fill_sparse.push(ascii_poly);
                                        up.virtual_support.push(ascii_poly);
                                    }

                                    for (let iterText = 0; iterText < 3; iterText++) {
                                        if (!topOrBottom) {
                                            text_posX = text_posX + Math.sin(text_rot_ang)*(char_size*2);
                                            text_posY = text_posY - Math.cos(text_rot_ang)*(char_size*2);
                                            
                                        } else {
                                            text_posX = text_posX + Math.sin(text_rot_ang)*(-char_size*2);
                                            text_posY = text_posY - Math.cos(text_rot_ang)*(-char_size*2);
                                        }
                                        let ascii_poly_l = generateAsciiPolygons(surrogate.surro.id, text_posX, text_posY, out_rotation, surrogate_settings.text_size);
                                        for (let ascii_poly of ascii_poly_l)  {
                                            up.tops[0].fill_sparse.push(ascii_poly);
                                            up.virtual_support.push(ascii_poly);
                                        }
                                    }
                                    // for (let ascii_poly of ascii_poly_list3)  {
                                    //     up.tops[0].fill_sparse.push(ascii_poly);
                                    //     up.virtual_support.push(ascii_poly);
                                    // }
                                    // for (let ascii_poly of ascii_poly_list2) {
                                    //     let translation_points_copy = ascii_poly.points.clone();
                                    //     let after_padding_poly = base.newPolygon(translation_points_copy);
                                    //     let geometry_points2 = after_padding_poly.translatePoints(translation_points_copy, {x:surrogate_outline_area_only[0].bounds.maxx, y:surrogate_outline_area_only[0].bounds.maxy, z:0});
                                    //     let prismPolygon = base.newPolygon(geometry_points2);
                                    //     up.tops[0].fill_sparse.push(prismPolygon);

                                    // } 

                                    console.log({pauseLayers:surrogate_settings.pauseLayers});
                                    console.log({thisSurrogateLayer:surrogate.insertion_data.printed_layer_index});
                                    let pausesString = "";
                                    console.log({pauseLayersIndex:surrogate_settings.pauseLayers.indexOf(Math.floor(surrogate.insertion_data.printed_layer_index))}); 


                                }
                                
                            }
                            
                            // console.log({surrogate_outline_area_only:surrogate_outline_area_only});

                            //console.log({up_support:up.supports});
                            //up.supports.push(surrogate.geometry[0]);
                            //console.log({geometry:surrogate.geometry});




                            surrogate.outlines_drawn++;
                        }

                        // Trying to add outlines directly
                        if (false) { //(surrogate.outlines_drawn >= 2 && surrogate.outlines_drawn <= 3) {
                            let surrogate_outline = [];
                            let surrogate_outline2 = [];
                            surrogate_outline = POLY.expand(surrogate.geometry, 0.1, up.z, surrogate_outline, 1);

                            let surrogate_outline_area_only = [];
                            POLY.subtract(surrogate_outline, surrogate.geometry, surrogate_outline_area_only, null, slice.z, min);
                            //POLY.expand(surrogate_outline, -0.2, up.z, surrogate_outline2);
                            //surrogate_outline[0].setOpen(true);
                            //surrogate_outline[0].points = surrogate_outline[0].points.slice(0, 3);
                            console.log({surrogate_outline_area_only:surrogate_outline_area_only});
                            //surrogate_outline[0].area2 = 0;
                            
                            //console.log({surrogate_outline2:surrogate_outline2});
                            up.supports.push(surrogate_outline_area_only[0]);
                            surrogate.outlines_drawn++;
                            let up_top_zero = up.tops[0];
                            if (!up_top_zero.fill_sparse) up_top_zero.fill_sparse = [];
                            //up_top_zero.fill_sparse.appendAll(surrogate_outline);

                        }
                    }
                }
                top_slice = up;
                up = up.up; 
            } // top_slice should now be at the top
        

            // LWW TODO: Remove this warning check if insertion layers are too close
            let iterating_down = top_slice;
            surrogates_placed.sort((a, b) => (a.insertion_data.new_layer_index > b.insertion_data.new_layer_index) ? 1 : -1);
            let last_surrogate;
            surrogates_placed.forEach(function(surrogate) {
                if (last_surrogate && Math.abs(surrogate.insertion_data.new_layer_index - last_surrogate.insertion_data.new_layer_index) === 1) {
                    console.log({WARNING:"Surrogates are on consecutive layers!"});
                }
                last_surrogate = surrogate;
            });


            // Adjust layer heights and slide in new layers at surrogate top ends
            while (iterating_down) {
                let surrogates_at_this_index = [];
                let all_other_surrogates = [];
                surrogates_placed.forEach(function(surrogate) {
                    if (surrogate.insertion_data.new_layer_index === iterating_down.index) {
                        surrogates_at_this_index.push(surrogate);
                    }
                    else {
                        all_other_surrogates.push(surrogate);
                    }
                });
                
                if (surrogates_at_this_index.length >= 1) {
                    // Add pause layer at index of already printed layer
                    addPauseLayer(surrogates_at_this_index[0].insertion_data.printed_layer_index, settings, surrogate_settings);

                    console.log({surrogates_at_this_index:surrogates_at_this_index});
                    let new_layer_height_range = get_height_range(iterating_down);
                    let printed_layer_height_range = get_height_range(iterating_down.down);
                    let new_layer_new_height_values;
                    let printed_layer_new_height_values;
                    let change_slices = true;

                    // Special case: Multiple surrogates on one slice
                    if (surrogates_at_this_index.length > 1) {
                        console.log({Status:"Multiple surrogates."});
                        
                        let only_simple_case = true;
                        let lowest_height = Number.POSITIVE_INFINITY;
                        let highest_height = -1;
                        // Check which cases are present
                        surrogates_at_this_index.forEach(function(surrogate) {
                            if (highest_height < surrogate.insertion_data.max_height) highest_height = surrogate.insertion_data.max_height;
                            if (lowest_height > surrogate.insertion_data.min_height) lowest_height = surrogate.insertion_data.min_height;
                            if (surrogate.insertion_data.insertion_case != "extend_printed_layer") only_simple_case = false;         
                        });

                        if (only_simple_case) {
                            // set bot of new layer and top of printed layer to found max height == Extend both up
                            new_layer_new_height_values = get_slice_height_values(new_layer_height_range.top_height, highest_height);
                            printed_layer_new_height_values = get_slice_height_values(highest_height, printed_layer_height_range.bottom_height);
                            
                        }
                        else {
                            // set bot of new layer and top of printed layer to found min height (extrude down a lot) // LWW TODO: make sure z is high enough for all surrogates, droop as much as necessary
                            new_layer_new_height_values = get_slice_height_values(new_layer_height_range.top_height, lowest_height);
                            printed_layer_new_height_values = get_slice_height_values(lowest_height, printed_layer_height_range.bottom_height);
                        }
                        
                    }
                    // Simple cases: One surrogate on the slice
                    else if (surrogates_at_this_index.length === 1) {
                        if (surrogates_at_this_index[0].insertion_data.insertion_case === "Insert_new_support_layer") {
                            change_slices = false;
                            let original_supports = surrogates_at_this_index[0].insertion_data.original_supports;
                            let only_support_above_this_surrogate = [];
                            let only_support_above_this_surrogate_2 = [];
                            // console.log({slideInSlice:surrogates_at_this_index[0]});
                            // console.log({iterating_down:iterating_down});
                            // console.log({iterating_down_DOWN:iterating_down.down});
                            
                            // Get only the diff of supports (after surrogating) from the printed slice
                            if (false) {
                                original_supports.forEach(function(original_supp) {
                                    console.log({original_supp:original_supp});
                                    let support_diff = original_supp;
                                    if (iterating_down.down.supports) {
                                        iterating_down.down.supports.forEach(function(supp) {
                                            let full_arr = support_diff;
                                            let subtract_arr = supp;
                                            let out_arr = [];
                                            support_diff = POLY.subtract(full_arr, subtract_arr, out_arr, null, new_layer_height_range.bottom_height, min);
                                        });
                                    }
                                    // support_diff.forEach(function(diff) {
                                    //     only_support_above_this_surrogate.push(diff);
                                    // });
                                    only_support_above_this_surrogate.push(support_diff);
                                });
                            }


                            // Support on the new slide-in slice are: 
                            //      - The original supports MINUS
                            //          - remaining supports
                            //          - other surrogate geometriues
                            // First collect all geometries that should be removed from original supports 
                            let collect_all_polygons_removed_from_support = [];
                            let collect_all_surrogate_geometries_removed_from_support = [];

                            // There will be overlap unless we expand the remaining supports
                            let support_enlarged = []
                            support_enlarged = POLY.expand(iterating_down.down.supports, 0.4, iterating_down.down.z, support_enlarged, 1);
                            support_enlarged.forEach(function(supp) {
                                collect_all_polygons_removed_from_support.push(supp);
                            });


                            all_other_surrogates.forEach(function(surrogate) {
                                collect_all_surrogate_geometries_removed_from_support = collect_all_surrogate_geometries_removed_from_support.concat(getSurrogateGeometryAtIndexHeight(surrogate, iterating_down.down.z));
                                // console.log({other_surrogate_geometries:getSurrogateGeometryAtIndexHeight(surrogate, iterating_down.down.z)});
                            });


                            console.log({collected_polygons:collect_all_polygons_removed_from_support});
                            console.log({collected_surrogate_geometries:collect_all_surrogate_geometries_removed_from_support});
                            // Get only the support on top of the current surrogate by subtracting original supports minus remaining supports/surrogates
                            // Must do this in two separate steps, otherwise the subtract function adds a new polygon where support/surrogate outlines meet
                            if (collect_all_polygons_removed_from_support.length > 0) {
                                POLY.subtract(original_supports, collect_all_polygons_removed_from_support, only_support_above_this_surrogate_2, null, new_layer_height_range.bottom_height, min);
                            } else {
                                only_support_above_this_surrogate_2 = original_supports;
                            }
                            if (only_support_above_this_surrogate_2.length > 0) {
                                POLY.subtract(only_support_above_this_surrogate_2, collect_all_surrogate_geometries_removed_from_support, only_support_above_this_surrogate, null, new_layer_height_range.bottom_height, min);
                            } else {
                                only_support_above_this_surrogate = only_support_above_this_surrogate_2;
                            }


                            // console.log({original_supports:original_supports});
                            // console.log({down_supports:iterating_down.down.supports});
                            // console.log({only_support_above_this_surrogate:only_support_above_this_surrogate});
                            
                            // Testing
                            // iterating_down.down.supports.forEach(function(supp) {
                            //     only_support_above_this_surrogate.push(supp);
                            // });

                            let slide_in_slice_height_values = get_slice_height_values(new_layer_height_range.bottom_height + surrogate_settings.minimum_clearance_height, surrogates_at_this_index[0].end_height, false);
                            let slide_in_slice = newSlice(slide_in_slice_height_values.z, view);
                            slide_in_slice.height = slide_in_slice_height_values.height;
                            slide_in_slice.widget = iterating_down.widget; 
                            slide_in_slice.extruder = iterating_down.extruder; 
                            slide_in_slice.isSparseFill = iterating_down.isSparseFill;
                            slide_in_slice.isSolidLayer = iterating_down.isSolidLayer;
                            slide_in_slice.offsets = iterating_down.offsets;
                            //slide_in_slice.finger = iterating_down.finger;
                            slide_in_slice.supports = only_support_above_this_surrogate;

                            slide_in_slice.down = iterating_down.down;
                            slide_in_slice.up = iterating_down;
                            iterating_down.down.up = slide_in_slice;
                            iterating_down.down = slide_in_slice;
                            slide_in_slice.index = iterating_down.index;

                            // Adjust all slice indexes above
                            iterating_down.index = iterating_down.index + 1;
                            let correcting_chain = iterating_down;
                            while (correcting_chain.up) {
                                correcting_chain = correcting_chain.up;
                                correcting_chain.index = correcting_chain.index + 1;
                            }

                            console.log({slide_in_slice:slide_in_slice});
                            console.log({iterating_down:iterating_down.index});
                            console.log({Case:"Insert_new_support_layer"})

                            // Now skip the newly added slice
                            iterating_down = iterating_down.down;
                        } 
                        else if (surrogates_at_this_index[0].insertion_data.insertion_case === "extend_printed_layer") {
                            let highest_height = surrogates_at_this_index[0].insertion_data.max_height;
                            new_layer_new_height_values = get_slice_height_values(new_layer_height_range.top_height, highest_height);
                            printed_layer_new_height_values = get_slice_height_values(highest_height, printed_layer_height_range.bottom_height);
                            console.log({iterating_down:iterating_down.index});
                            console.log({Case:"extend_printed_layer"})
                            console.log({highest_height:highest_height});
                        }
                        else if (surrogates_at_this_index[0].insertion_data.insertion_case === "extend_new_layer") {
                            let lowest_height = surrogates_at_this_index[0].insertion_data.min_height;
                            new_layer_new_height_values = get_slice_height_values(new_layer_height_range.top_height, lowest_height);
                            printed_layer_new_height_values = get_slice_height_values(lowest_height, printed_layer_height_range.bottom_height);
                            console.log({iterating_down:iterating_down.index});
                            console.log({Case:"extend_new_layer"})
                            console.log({lowest_height:lowest_height});
                        }
                    }
                    if (change_slices) {
                        iterating_down.z = new_layer_new_height_values.z;
                        iterating_down.height = new_layer_new_height_values.height;
                        iterating_down.down.z = printed_layer_new_height_values.z;
                        iterating_down.down.height = printed_layer_new_height_values.height;

                        
                        
                        console.log({printed_layer_height_range:printed_layer_height_range});
                        console.log({changed_slice:iterating_down});
                        console.log({all_slices:all_slices});
                        console.log({insertion_case:surrogates_at_this_index[0].insertion_data.insertion_case});
                    }
                }

                iterating_down = iterating_down.down;
                
            }

            // Add pauses text and ID

            for (let draw_pause_text_idx = 0; draw_pause_text_idx < surrogates_placed.length; draw_pause_text_idx++) {
                let currentSurrogate = surrogates_placed[draw_pause_text_idx];
                // let iterateSurrogate = surrogates_placed[draw_pause_text_idx];
                console.log({insertData:currentSurrogate});
                if (currentSurrogate.starting_height > 0) continue;

                let text_rotation = currentSurrogate.rotation;
                let out_rotation = text_rotation;
                let text_rot_ang;

                let text_posX = currentSurrogate.text_posX;
                let text_posY = currentSurrogate.text_posY;
                let text_posX_alt = currentSurrogate.text_posX;
                let text_posY_alt = currentSurrogate.text_posY;
                
                if (currentSurrogate.surro.type == "prismNOO") {
                    console.log({surrogate_enlarged_bounds:surrogate_outline_area_only[0].bounds});
                    console.log({outline_points:surrogate_outline_area_only[0]});
                    text_posX = surrogate_outline_area_only[0].points[0].x;
                    text_posY = surrogate_outline_area_only[0].points[0].y;
                }

                text_rotation = text_rotation % 360; // Rotate until within 360°
                // Rotate values below 0 by one full rotation
                if (text_rotation <= 0) {
                    text_rotation = text_rotation + 360;
                }

                let topOrBottom = true;
                
                // if (currentSurrogate.surro.type != "prism") { 
                if (true) { 

                    if (text_rotation > 90 && text_rotation <= 270) { // Top-left + Bottom Left --> Flip text
                        out_rotation = text_rotation + 180;
                    } else {

                    }

                    text_rot_ang = out_rotation * Math.PI / 180;
                    text_posX = text_posX - Math.cos(text_rot_ang)*currentSurrogate.surro.length*0.5 + Math.sin(text_rot_ang)*(-currentSurrogate.surro.width*0.5-3); // sin angle was minus, but also minus the whole term
                    text_posY = text_posY - Math.sin(text_rot_ang)*currentSurrogate.surro.length*0.5 - Math.cos(text_rot_ang)*(-currentSurrogate.surro.width*0.5-3);

                    text_posX_alt = text_posX_alt - Math.cos(text_rot_ang)*(currentSurrogate.surro.length*0.5) + Math.sin(text_rot_ang)*(currentSurrogate.surro.width*0.5+char_size+3.5);
                    text_posY_alt = text_posY_alt - Math.sin(text_rot_ang)*(currentSurrogate.surro.length*0.5) - Math.cos(text_rot_ang)*(currentSurrogate.surro.width*0.5+char_size+3.5);

                    let textOption1 = newPoint(text_posX, text_posY, 0.0);
                    let textOption2 = newPoint(text_posX_alt, text_posY_alt, 0.0);
                    let midPoint = newPoint(0.0, 0.0, 0.0);

                    if (midPoint.distTo2D(textOption1) < midPoint.distTo2D(textOption2)) {
                        text_posX = text_posX_alt;
                        text_posY = text_posY_alt;
                        topOrBottom = false;
                    }

                    

                    console.log({Dist1:midPoint.distTo2D(textOption1)});
                    console.log({Dist2:midPoint.distTo2D(textOption2)});

                }
                else {
                    const length = currentSurrogate.geometry[0].bounds.maxx - currentSurrogate.geometry[0].bounds.minx;
                    const width = currentSurrogate.geometry[0].bounds.maxy - currentSurrogate.geometry[0].bounds.miny;
                    // const length = currentSurrogate.surro.length;
                    // const width = currentSurrogate.surro.width;
                    if (text_rotation > 0 && text_rotation <= 90) { // Top-right
                        text_rot_ang = text_rotation * Math.PI / 180;
                        out_rotation = text_rotation;
                        text_posX = text_posX - Math.cos(text_rot_ang)*length*0.5 - Math.sin(-text_rot_ang)*(-width*0.5-2);
                        text_posY = text_posY - Math.sin(text_rot_ang)*length*0.5 - Math.cos(text_rot_ang)*(-width*0.5-2);

                        const angle_compensation = 45 - Math.abs((out_rotation % 90)-45);
                        text_posX = text_posX - Math.sin(-text_rot_ang)*(angle_compensation*0.13);
                        text_posY = text_posY - Math.cos(text_rot_ang)*(angle_compensation*0.13);

                    }
                    else if (text_rotation > 90 && text_rotation <= 180) { // Top-left
                        out_rotation = text_rotation + 180;
                        text_rot_ang = out_rotation * Math.PI / 180;
                        text_posX = text_posX - Math.cos(text_rot_ang)*length*0.5 - Math.sin(-text_rot_ang)*(-width*0.5-2);
                        text_posY = text_posY - Math.sin(text_rot_ang)*length*0.5 - Math.cos(text_rot_ang)*(-width*0.5-2);
                    }
                    else if (text_rotation > 180 && text_rotation <= 270) { // Bottom-left
                        out_rotation = text_rotation + 180;
                        text_rot_ang = out_rotation * Math.PI / 180;
                        text_posX = text_posX - Math.cos(text_rot_ang)*length*0.5 - Math.sin(-text_rot_ang)*(-width*0.5);
                        text_posY = text_posY - Math.sin(text_rot_ang)*length*0.5 - Math.cos(text_rot_ang)*(-width*0.5);

                        const angle_compensation = 45 - Math.abs((out_rotation % 90)-45);
                        text_posX = text_posX - Math.sin(-text_rot_ang)*(-angle_compensation*0.05);
                        text_posY = text_posY - Math.cos(text_rot_ang)*(-angle_compensation*0.05);
                    }
                    else if (text_rotation > 270 && text_rotation <= 360) { // Bottom-right
                        out_rotation = text_rotation;
                        text_rot_ang = out_rotation * Math.PI / 180;
                        text_posX = text_posX - Math.cos(text_rot_ang)*length*0.5 - Math.sin(-text_rot_ang)*(-width*0.5-2);
                        text_posY = text_posY - Math.sin(text_rot_ang)*length*0.5 - Math.cos(text_rot_ang)*(-width*0.5-2);
                        const angle_compensation = 45 - Math.abs((out_rotation % 90)-45);
                        text_posX = text_posX - Math.sin(-text_rot_ang)*(angle_compensation*0.13);
                        text_posY = text_posY - Math.cos(text_rot_ang)*(angle_compensation*0.13);
                    } else {
                        console.log({WARNING:"Warning: text rotation out of handled range"});
                    }

                    
                }


                let tower_surrogates = get_all_surrogates_on_top(currentSurrogate, []);

                if (!topOrBottom && tower_surrogates.length > 0) {
                    text_posX = text_posX + Math.sin(text_rot_ang)*(char_size*2)*(tower_surrogates.length);
                    text_posY = text_posY - Math.cos(text_rot_ang)*(char_size*2)*(tower_surrogates.length);
                }

                const firstString = "P" + (surrogate_settings.pauseLayers.indexOf(currentSurrogate.insertion_data.printed_layer_index) + 1).toString() + " " +currentSurrogate.surro.id;

                let ascii_poly_list2 = generateAsciiPolygons(firstString, text_posX, text_posY, out_rotation, surrogate_settings.text_size);

                // let textTop = bottom_slice.tops[0].clone(true);
                // textTop.poly = undefined;
                // console.log({textTop:textTop});
                // if (!textTop.fill_sparse) textTop.fill_sparse = [];

                for (let ascii_poly of ascii_poly_list2)  {
                    bottom_slice.tops[0].fill_sparse.push(ascii_poly);
                    bottom_slice.tops[0].fill_sparse.push(ascii_poly);
                    // bottom_slice.up.tops[0].fill_sparse.push(ascii_poly);
                    // bottom_slice.up.tops[0].fill_sparse.push(ascii_poly);
                    bottom_slice.virtual_support.push(ascii_poly);
                    
                    // textTop.fill_sparse.push(ascii_poly);
                    // bottom_slice.tops.push(textTop);
                }

                for (let iterText = 0; iterText < 3; iterText++) {

                }

                console.log({pauseLayers:surrogate_settings.pauseLayers});
                console.log({thisSurrogateLayer:currentSurrogate.insertion_data.printed_layer_index});
                console.log({pauseLayersIndex:surrogate_settings.pauseLayers.indexOf(Math.floor(currentSurrogate.insertion_data.printed_layer_index))}); 

                

                console.log({towersurrs:tower_surrogates});

                tower_surrogates.forEach(function(upSupp) {
                    if (true) {
                        text_posX = text_posX + Math.sin(text_rot_ang)*(-char_size*2);
                        text_posY = text_posY - Math.cos(text_rot_ang)*(-char_size*2);
                        
                    } else {
                        text_posX = text_posX + Math.sin(text_rot_ang)*(-char_size*2);
                        text_posY = text_posY - Math.cos(text_rot_ang)*(-char_size*2);
                    }
                    const additionalString = "P" + (surrogate_settings.pauseLayers.indexOf(upSupp.insertion_data.printed_layer_index) + 1).toString() + " " +upSupp.surro.id;
                    let ascii_poly_l = generateAsciiPolygons(additionalString, text_posX, text_posY, out_rotation, surrogate_settings.text_size);
                    for (let ascii_poly of ascii_poly_l)  {
                        bottom_slice.tops[0].fill_sparse.push(ascii_poly);
                        bottom_slice.tops[0].fill_sparse.push(ascii_poly);
                        // bottom_slice.up.tops[0].fill_sparse.push(ascii_poly);
                        // bottom_slice.up.tops[0].fill_sparse.push(ascii_poly);
                        bottom_slice.virtual_support.push(ascii_poly);
                    }
                });

                if (false) {

                    let pausesString = "Pause " + (surrogate_settings.pauseLayers.indexOf(currentSurrogate.insertion_data.printed_layer_index) + 1).toString();
                    while (iterateSurrogate.up_surrogate.length > 1) {
                        iterateSurrogate = iterateSurrogate.up_surrogate[0];
                        pausesString += " & ";
                        pausesString += (surrogate_settings.pauseLayers.indexOf(iterateSurrogate.insertion_data.printed_layer_index) + 1).toString();
                    }

                    let text_rotation = currentSurrogate.rotation;
                    let out_rotation = 0;
                    let text_rot_ang = 0;
                    
                    let text_posX = currentSurrogate.text_posX;
                    let text_posY = currentSurrogate.text_posY;

                    text_rotation = text_rotation % 360;
                    // Rotate values below 0 by one full rotation
                    if (text_rotation <= 0) {
                        text_rotation = text_rotation + 360;
                    }
                    

                    if (currentSurrogate.surro.type != "prism") {
                        if (text_rotation > 0 && text_rotation <= 90) { // Top-right
                            text_rot_ang = text_rotation * Math.PI / 180;
                            // text_posX = text_posX - Math.cos(text_rot_ang)*(pausesString.length*char_size) - Math.sin(-text_rot_ang)*(7);
                            // text_posY = text_posY - Math.sin(text_rot_ang)*(pausesString.length*char_size) - Math.cos(text_rot_ang)*(7);
                            out_rotation = text_rotation;
                        }
                        else if (text_rotation > 90 && text_rotation <= 180) { // Top-left
                            out_rotation = text_rotation + 180;
                            text_rot_ang = out_rotation * Math.PI / 180;
                            // text_posX = text_posX - Math.cos(text_rot_ang)*(currentSurrogate.surro.length) - Math.sin(-text_rot_ang)*(-1.5);
                            // text_posY = text_posY - Math.sin(text_rot_ang)*(currentSurrogate.surro.length) - Math.cos(text_rot_ang)*(-1.5);
                        }
                        else if (text_rotation > 180 && text_rotation <= 270) { // Bottom-left
                            out_rotation = text_rotation + 180;
                            text_rot_ang = out_rotation * Math.PI / 180;
                            // text_posX = text_posX - Math.cos(text_rot_ang)*(currentSurrogate.surro.length) - Math.sin(-text_rot_ang)*(-2-currentSurrogate.surro.width);
                            // text_posY = text_posY - Math.sin(text_rot_ang)*(currentSurrogate.surro.length) - Math.cos(text_rot_ang)*(-2-currentSurrogate.surro.width);
                        }
                        else if (text_rotation > 270 && text_rotation <= 360) { // Bottom-right
                            out_rotation = text_rotation;
                            text_rot_ang = out_rotation * Math.PI / 180;
                            // text_posX = text_posX - Math.cos(text_rot_ang)*(pausesString.length*char_size) - Math.sin(-text_rot_ang)*(8+currentSurrogate.surro.width);
                            // text_posY = text_posY - Math.sin(text_rot_ang)*(pausesString.length*char_size) - Math.cos(text_rot_ang)*(8+currentSurrogate.surro.width);
                        } else {
                            console.log({WARNING:"Warning: text rotation out of handled range"});
                        }

                        text_posX = text_posX - Math.cos(text_rot_ang)*(-currentSurrogate.surro.length*0.5+(pausesString.length*char_size)) - Math.sin(-text_rot_ang)*(currentSurrogate.surro.width*0.5+7.5);
                        text_posY = text_posY - Math.sin(text_rot_ang)*(-currentSurrogate.surro.length*0.5+(pausesString.length*char_size)) - Math.cos(text_rot_ang)*(currentSurrogate.surro.width*0.5+7.5);
                    }
                    else {
                        const length = currentSurrogate.geometry[0].bounds.maxx - currentSurrogate.geometry[0].bounds.minx;
                        const width = currentSurrogate.geometry[0].bounds.maxy - currentSurrogate.geometry[0].bounds.miny;
                        // const length = surrogate.surro.length;
                        // const width = surrogate.surro.width;
                        if (text_rotation > 0 && text_rotation <= 90) { // Top-right
                            text_rot_ang = text_rotation * Math.PI / 180;
                            out_rotation = text_rotation;
                            text_posX = text_posX - Math.cos(text_rot_ang)*(-length*0.35+(pausesString.length*char_size)) - Math.sin(-text_rot_ang)*(width*0.5+6.5);
                            text_posY = text_posY - Math.sin(text_rot_ang)*(-length*0.35+(pausesString.length*char_size)) - Math.cos(text_rot_ang)*(width*0.5+6.5);

                            const angle_compensation = 45 - Math.abs((out_rotation % 90)-45);
                            text_posX = text_posX - Math.sin(-text_rot_ang)*(angle_compensation*0.01);
                            text_posY = text_posY - Math.cos(text_rot_ang)*(angle_compensation*0.01);

                        }
                        else if (text_rotation > 90 && text_rotation <= 180) { // Top-left
                            out_rotation = text_rotation + 180;
                            text_rot_ang = out_rotation * Math.PI / 180;
                            text_posX = text_posX - Math.cos(text_rot_ang)*(-length*0.35+(pausesString.length*char_size)) - Math.sin(-text_rot_ang)*(width*0.5+7.5);
                            text_posY = text_posY - Math.sin(text_rot_ang)*(-length*0.35+(pausesString.length*char_size)) - Math.cos(text_rot_ang)*(width*0.5+7.5);

                            const angle_compensation = 45 - Math.abs((out_rotation % 90)-45);
                            text_posX = text_posX - Math.sin(-text_rot_ang)*(-angle_compensation*0.1);
                            text_posY = text_posY - Math.cos(text_rot_ang)*(-angle_compensation*0.1);
                        }
                        else if (text_rotation > 180 && text_rotation <= 270) { // Bottom-left
                            out_rotation = text_rotation + 180;
                            text_rot_ang = out_rotation * Math.PI / 180;
                            text_posX = text_posX - Math.cos(text_rot_ang)*(-length*0.35+(pausesString.length*char_size)) - Math.sin(-text_rot_ang)*(width*0.5+6.5);
                            text_posY = text_posY - Math.sin(text_rot_ang)*(-length*0.35+(pausesString.length*char_size)) - Math.cos(text_rot_ang)*(width*0.5+6.5);

                            const angle_compensation = 45 - Math.abs((out_rotation % 90)-45);
                            text_posX = text_posX - Math.sin(-text_rot_ang)*(-angle_compensation*0.1);
                            text_posY = text_posY - Math.cos(text_rot_ang)*(-angle_compensation*0.1);
                        }
                        else if (text_rotation > 270 && text_rotation <= 360) { // Bottom-right
                            out_rotation = text_rotation;
                            text_rot_ang = out_rotation * Math.PI / 180;
                            text_posX = text_posX - Math.cos(text_rot_ang)*(-length*0.35+(pausesString.length*char_size)) - Math.sin(-text_rot_ang)*(width*0.5+4.5);
                            text_posY = text_posY - Math.sin(text_rot_ang)*(-length*0.35+(pausesString.length*char_size)) - Math.cos(text_rot_ang)*(width*0.5+4.5);
                            const angle_compensation = 45 - Math.abs((out_rotation % 90)-45);
                            text_posX = text_posX - Math.sin(-text_rot_ang)*(angle_compensation*+0.05);
                            text_posY = text_posY - Math.cos(text_rot_ang)*(angle_compensation*+0.05);
                        } else {
                            console.log({WARNING:"Warning: text rotation out of handled range"});
                        }

                        
                    }
                

                    let ascii_poly_list = generateAsciiPolygons(pausesString, text_posX, text_posY, out_rotation, surrogate_settings.text_size);
                    for (let ascii_poly of ascii_poly_list) {
                        bottom_slice.tops[0].fill_sparse.push(ascii_poly);
                        bottom_slice.virtual_support.push(ascii_poly);
                    }
                }
            }


        }

        // Old way of determining surrogates on a layer
        if (false) {
            up = bottom_slice;
            let heighest_surrogate_top = -1; // -1 means no surrogate ends in the previous layer
            // adjust following layer (only support?) heights based on surrogate top heights
            while (up) {
                // Set z of next layer to a height with good chance of sticking to surrogate, and adjust it's height accordingly // LWW TODO: Might want to change this to increase extrusion here
                if (heighest_surrogate_top > -1) {
                    let target_layer_top = up.z + up.height;
                    // up.z = heighest_surrogate_top + layer_height_fudge;
                    // up.height = (target_layer_top - up.z) + print_on_surrogate_extra_height_for_extrusion;

                    let slide_in_slice = newSlice(up.z, view);
                    //let slide_in_slice = up.z.clone();
                    //slide_in_slice.tops = up.tops;
                    slide_in_slice.widget = up.widget; 
                    slide_in_slice.extruder = up.extruder; 
                    slide_in_slice.isSparseFill = up.isSparseFill;
                    slide_in_slice.isSolidLayer = up.isSolidLayer;
                    slide_in_slice.offsets = up.offsets;

                    
                    slide_in_slice.down = up.down;
                    slide_in_slice.up = up;
                    up.down.up = slide_in_slice;
                    up.down = slide_in_slice;
                    slide_in_slice.index = up.index;
                    slide_in_slice.z = heighest_surrogate_top + layer_height_fudge;
                    slide_in_slice.height = (target_layer_top - slide_in_slice.z) + print_on_surrogate_extra_height_for_extrusion;
                    
                    // copy_supports(slide_in_slice, up);
                    
                    if (!slide_in_slice.supports) slide_in_slice.supports = [];
                    up.supports.forEach(function(supp) {
                        slide_in_slice.supports.push(supp);
                    });
                    
                    console.log({slide_in_slice:slide_in_slice});
                    console.log({slide_in_slide_supports:slide_in_slice.supports});
                    slide_in_slice.is_surrogate_end_slice = true;
                    

                    up.index = up.index + 1;
                    let correcting_chain = up;
                    while (correcting_chain.up) {
                        correcting_chain = correcting_chain.up;
                        correcting_chain.index = correcting_chain.index + 1;
                    }
                }

                heighest_surrogate_top = -1;

                // Find heighest surrogate that ends in the range of this layers thickness
                for (let heigh_surrogate_idx = 0; heigh_surrogate_idx < surrogates_placed.length; heigh_surrogate_idx++) {
                    let surrogate = surrogates_placed[heigh_surrogate_idx];
                    let end_height = surrogate.surro.height + surrogate.starting_height;
                    if (end_height > up.z && end_height < up.z + up.height && end_height > heighest_surrogate_top) {
                        heighest_surrogate_top = end_height;
                    }
                }
                up = up.up;
                if (up && up.is_surrogate_end_slice) up = up.up; // Skip the newly added layer
            }
        }


        let post_surrogate_support_amounts = getTotalSupportVolume(bottom_slice);
        console.log({post_surrogate_support_amounts:post_surrogate_support_amounts});

        let volume_saved = pre_surrogate_support_amounts[0] - post_surrogate_support_amounts[0];
        let volume_percentage_saved = volume_saved / pre_surrogate_support_amounts[0];
        if (isNaN(volume_percentage_saved)) volume_percentage_saved = 0;

        
        bottom_slice.handled = true;
        let all_out_slices = [];
        up = bottom_slice;
        // For all slices
        while (up) {
            up.replaced_volume = volume_saved;
            all_out_slices.push(up);
            up = up.up;
            
        }

        // function download(filename, text) {
        //     var pom = document.createElement('a');
        //     pom.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
        //     pom.setAttribute('download', filename);
        
        //     if (document.createEvent) {
        //         var event = document.createEvent('MouseEvents');
        //         event.initEvent('click', true, true);
        //         pom.dispatchEvent(event);
        //     }
        //     else {
        //         pom.click();
        //     }
        // }
        // let timestamp = Date.now();
        // let csv_log = "";

        // // Header
        // csv_log += "stl_name,surrogating_duration,empty1,empty2,empty3,empty4,empty5,total_time,total_number_of_files";

        // console.log(bottom_slice.widget);
        // download(bottom_slice.widget.stats.timestamp+"_"+bottom_slice.widget.id+".txt", csv_log);

        // API.event.emit('log.file', {any:"thing"});


        // API.event.emit('log.fileDetail', {timestamp:bottom_slice.widget.surrogate_data.timestamp, id:bottom_slice.widget.id, previous_volume:pre_surrogate_support_amounts[0], new_volume:post_surrogate_support_amounts[0], volume_percentage_saved:volume_percentage_saved});


        var endTime = new Date().getTime();
        var sTime = endTime - startTime;

        // More logging for research purposes

        const efficiencyData = {numberPauses: surrogate_settings.pauseLayers.length, numberSurrogates: surrogates_placed.length, materialWeightEstimateTube: 0, materialWeightEstimateBar: 0, materialWeightEstimateEllipse: 0, timestamp:bottom_slice.widget.surrogate_data.timestamp, id:bottom_slice.widget.id, previous_volume:pre_surrogate_support_amounts[0], new_volume:post_surrogate_support_amounts[0], volume_percentage_saved:volume_percentage_saved, sTime:sTime};

        console.log({efficiencyData:efficiencyData});

        // TODO: Make this not super ugly, return properly
        bottom_slice.efficiencyData = efficiencyData;

        // function download(filename, text) {
        //     var pom = document.createElement('a');
        //     pom.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
        //     pom.setAttribute('download', filename);
        
        //     if (document.createEvent) {
        //         var event = document.createEvent('MouseEvents');
        //         event.initEvent('click', true, true);
        //         pom.dispatchEvent(event);
        //     }
        //     else {
        //         pom.click();
        //     }
        // }
        // let csv_log = "";

        // csv_log += ","+efficiencyData.id+",,"+efficiencyData.previous_volume+","+efficiencyData.new_volume+","+efficiencyData.volume_percentage_saved+",,,,";

        // download(efficiencyData.timestamp+"_"+efficiencyData.id+".txt", csv_log);

        console.log({slicing_results_obj:efficiencyData});


        console.log({theWidget:bottom_slice.widget});

        console.log({surrogate_all_slices:all_out_slices});

        return all_out_slices;
    }

    function doMaterialEstimation(bottom_slice) {
        function getTotalSupportMaterialEstimate(bottom_slice) {
            let iterate_layers_support = bottom_slice;
            let total_material_estimate = 0;
            let total_material_estimate_rect = 0;
            let total_material_estimate_ellipse = 0;
            // let originLength = 0;
            // let totalLength = 0;
            while (iterate_layers_support) {
                let support_line_length = 0;
                if (iterate_layers_support.supports) {
                    iterate_layers_support.supports.forEach(function(supp) {
                        for (let pt = 0; pt < supp.points.length-1; pt++){
                            support_line_length += supp.points[pt].distTo2D(supp.points[pt+1]);
                        }
                        if (supp.open === false) {
                            support_line_length += supp.points[supp.points.length-1].distTo2D(supp.points[0]);
                        }
                        if (supp.fill) {
                            for (let pt = 0; pt < supp.fill.length-1; pt++){
                                support_line_length += supp.fill[pt].distTo2D(supp.fill[pt+1]);
                            }
                        }
                    });
                }
                if (iterate_layers_support.virtual_support) { 
                    iterate_layers_support.virtual_support.forEach(function(supp) {
                        let support_line_length = 0;
                        for (let pt = 0; pt < supp.points.length-1; pt++){
                            support_line_length += supp.points[pt].distTo2D(supp.points[pt+1]);
                        }
                        if (supp.open === false) {
                            support_line_length += supp.points[supp.points.length-1].distTo2D(supp.points[0]);
                        }
                    });
                }

                total_material_estimate += support_line_length*Math.PI*((iterate_layers_support.height/2)*(iterate_layers_support.height/2)); // line length * area of circle with slice height as diameter
                total_material_estimate_rect += support_line_length*iterate_layers_support.height*0.4; // line length * area of rectangle with length = layer height and width = extrusion width
                total_material_estimate_ellipse += support_line_length*Math.PI*((iterate_layers_support.height/2)*(0.2)); // line length * area of ellipse

                iterate_layers_support = iterate_layers_support.up;
            }

            return [total_material_estimate, total_material_estimate_rect, total_material_estimate_ellipse];
        }

        let results = getTotalSupportMaterialEstimate(bottom_slice);

        let efficiencyData = bottom_slice.efficiencyData; 

        efficiencyData.materialWeightEstimateTube = results[0]*1.25/1000*1.15; // times density of PLA times adjustment
        efficiencyData.materialWeightEstimateBar = results[1]*1.25/1000;
        efficiencyData.materialWeightEstimateEllipse = results[2]*1.25/1000*0.666666;

        bottom_slice.efficiencyData = efficiencyData;
    }
}

function bound(v,min,max) {
    return Math.max(min,Math.min(max,v));
}

function doRender(slice, isSynth, params, devel) {
    const output = slice.output();
    const height = slice.height / 2;
    const solidWidth = params.sliceFillWidth || 1;

    slice.tops.forEach(top => {
        if (isThin) output
            .setLayer('part', { line: 0x333333, check: 0x333333 })
            .addPolys(top.poly);

        output
            .setLayer("shells", isSynth ? COLOR.support : COLOR.shell)
            .addPolys(top.shells || [], vopt({ offset, height, clean: true }));

        output
            .setLayer("solid fill", isSynth ? COLOR.support : COLOR.fill)
            .addLines(top.fill_lines || [], vopt({ offset: offset * solidWidth, height }));

        if (!(slice.belt && slice.belt.anchor)) output
            .setLayer("sparse fill", COLOR.infill)
            .addPolys(top.fill_sparse || [], vopt({ offset, height, outline: true, trace:true }))

        if (slice.belt && slice.belt.anchor) output
            .setLayer("anchor", COLOR.anchor)
            .addPolys(top.fill_sparse || [], vopt({ offset, height, outline: true, trace:true }))

        if (top.thin_fill) output
            .setLayer("thin fill", COLOR.fill)
            .addLines(top.thin_fill, vopt({ offset, height }));

        if (top.gaps) output
            .setLayer("gaps", COLOR.gaps)
            .addPolys(top.gaps, vopt({ offset, height, thin: true }));

        if (isThin && devel && top.fill_off && top.fill_off.length) {
            slice.output()
                .setLayer('fill inset', { face: 0, line: 0xaaaaaa, check: 0xaaaaaa })
                .addPolys(top.fill_off);
                // .setLayer('last', { face: 0, line: 0x008888, check: 0x008888 })
                // .addPolys(top.last);
        }
    });

    if (isThin && devel) {
        if (slice.solids && slice.solids.length) output
            .setLayer("solids", { face: 0xbbbb00, check: 0xbbbb00 })
            .addAreas(slice.solids);

        if (slice.bridges && slice.bridges.length) output
            .setLayer("bridges", { face: 0x00cccc, line: 0x00cccc, check: 0x00cccc })
            .addAreas(slice.bridges);

        if (slice.flats && slice.flats.length) output
            .setLayer("flats", { face: 0xaa00aa, line: 0xaa00aa, check: 0xaa00aa })
            .addAreas(slice.flats);
    }

    if (slice.supports) output
        .setLayer("support", COLOR.support)
        .addPolys(slice.supports, vopt({ offset, height }));

    if (slice.supports) slice.supports.forEach(poly => {
        if (poly.fill) output
            .setLayer("support", COLOR.support)
            .addLines(poly.fill, vopt({ offset, height }));
    });

    if (slice.xray) {
        const color = [ 0xff0000, 0x00aa00, 0x0000ff, 0xaaaa00, 0xff00ff ];
        if (slice.lines) {
            slice.lines.forEach((line, i) => {
                const group = i % 5;
                slice.output().setLayer(`l${group}`, color[group]).addLine(line.p1, line.p2);
            });
        }
        if (slice.groups)
        POLY.nest(slice.groups).forEach((poly, i) => {
            const group = i % 5;
            slice.addTop(poly);
            // slice.output().setLayer(`g${i}`, 0x888888).addPoly(poly);
            slice.output().setLayer(`g${i}`, color[group]).addPoly(poly);
        });
    }

    // console.log(slice.index, slice.render.stats);
}

// shared with SLA driver and minions
FDM.share = {
    doShells,
    doTopShells,
    doDiff,
    projectFlats,
    projectBridges
};

/**
 * Compute offset shell polygons. For FDM, the first offset is usually half
 * of the nozzle width.  Each subsequent offset is a full nozzle width.  User
 * parameters control tweaks to these numbers to allow for better shell bonding.
 * The last shell generated is a "fillOffset" shell.  Fill lines are clipped to
 * this polygon.  Adjusting fillOffset controls bonding of infill to the shells.
 *
 * Most of this is done in slicePost() in FDM mode. now this is used by SLA, Laser
 *
 * @param {number} count
 * @param {number} offsetN
 * @param {number} fillOffset
 * @param {Obejct} options
 */
function doShells(slice, count, offset1, offsetN, fillOffset, opt = {}) {
    for (let top of slice.tops) {
        doTopShells(slice.z, top, count, offset1, offsetN, fillOffset, opt);
    }
}

/**
 * Create an entirely solid layer by filling all top polygons
 * with an alternating pattern.
 *
 * @param {number} linewidth
 * @param {number} angle
 * @param {number} density
 */
 function doSolidLayerFill(slice, spacing, angle) {
    if (slice.tops.length === 0 || typeof(angle) != 'number') {
        slice.isSolidLayer = false;
        return;
    }

    slice.tops.forEach(function(top) {
        let lines = fillArea(top.fill_off, angle, spacing, null);
        top.fill_lines.appendAll(lines);
    });

    slice.isSolidLayer = true;
};

/**
 * Take output from pluggable sparse infill algorithm and clip to
 * the bounds of the top polygons and their inner solid areas.
 */
function doSparseLayerFill(slice, options = {}) {
    let process = options.process,
        spacing = options.spacing,  // spacing space between fill lines
        density = options.density,  // density of infill 0.0 - 1.0
        bounds = options.bounds,    // bounding box of widget
        height = options.height,    // z layer height
        cache = !(options.cache === false),
        type = options.type || 'hex';

    if (slice.tops.length === 0 || density === 0.0 || slice.isSolidLayer || slice.index < 0) {
        slice.isSparseFill = false;
        return;
    }

    let tops = slice.tops,
        down = slice.down,
        clib = self.ClipperLib,
        ctyp = clib.ClipType,
        ptyp = clib.PolyType,
        cfil = clib.PolyFillType,
        clip = new clib.Clipper(),
        ctre = new clib.PolyTree(),
        poly,
        polys = [],
        lines = [],
        line = [],
        solids = [],
        // callback passed to pluggable infill algorithm
        target = {
            // slice and slice property access
            slice: function() { return slice },
            zIndex: function() { return slice.index },
            zValue: function() { return slice.z },
            // various option map access
            options: function() { return options },
            lineWidth: function() { return options.lineWidth },
            bounds: function() { return bounds },
            zHeight: function() { return height },
            offset: function() { return spacing },
            density: function() { return density },
            repeat: function() { return process.sliceFillRepeat },
            // output functions
            emit: function(x,y) {
                if (isNaN(x)) {
                    solids.push(x);
                } else {
                    line.push(newPoint(x, y, slice.z));
                    slice.isSparseFill = true;
                }
            },
            newline: function() {
                if (line.length > 0) {
                    lines.push(line);
                    line = [];
                }
            }
        };

    // use specified fill type
    if (type && fill[type]) {
        fill[type](target);
    } else {
        console.log({missing_infill: type});
        return;
    }

    // force emit of last line
    target.newline();

    // prepare top infill structure
    for (let top of tops) {
        top.fill_sparse = top.fill_sparse || [];
        polys.appendAll(top.fill_off);
        polys.appendAll(top.solids);
    }

    // update fill fingerprint for this slice
    slice._fill_finger = POLY.fingerprint(polys);

    let skippable = cache && fill_fixed[type] ? true : false;
    let miss = false;
    // if the layer below has the same fingerprint,
    // we may be able to clone the infill instead of regenerating it
    if (skippable && slice.fingerprintSame(down)) {
        // the fill fingerprint can slightly different because of solid projections
        if (down._fill_finger && POLY.fingerprintCompare(slice._fill_finger, down._fill_finger)) {
            for (let i=0; i<tops.length; i++) {
                // the layer below may not have infill computed if it's solid
                if (!down.tops[i].fill_sparse) {
                    miss = true;
                }
            }
            // mark for infill cloning if nothing is missing
            if (!miss) {
                slice._clone_sparse = true;
                return;
            }
        }
    }

    let sparse_clip = slice.isSparseFill;

    // solid fill areas
    if (solids.length) {
        for (let top of tops) {
            if (!top.fill_off) return;
            let masks = top.fill_off.slice();
            if (top.solids) {
                masks = POLY.subtract(masks, top.solids, [], null, slice.z);
            }
            let angl = process.sliceFillAngle * ((slice.index % 2) + 1);
            for (let solid of solids) {
                let inter = [],
                    fillable = [];
                for (let mask of masks) {
                    let p = solid.mask(mask);
                    if (p && p.length) inter.appendAll(p);
                }
                // offset fill area to accommodate trace
                if (inter.length) {
                    POLY.expand(inter, -options.lineWidth/2, slice.z, fillable);
                }
                // fill intersected areas
                if (inter.length) {
                    slice.isSparseFill = true;
                    for (let p of inter) {
                        p.forEachSegment((p1, p2) => {
                            top.fill_lines.push(p1, p2);
                        });
                    }
                }
                if (fillable.length) {
                    let lines = POLY.fillArea(fillable, angl, options.lineWidth);
                    top.fill_lines.appendAll(lines);
                }
            }
        }
    }

    // if only solids were added and no lines to clip
    if (!sparse_clip) {
        return;
    }

    if (options.promises) {
        options.promises.push(kiri.minions.clip(slice, polys, lines));
        return;
    }

    lines = lines.map(a => a.map(p => p.toClipper()));
    clip.AddPaths(lines, ptyp.ptSubject, false);
    clip.AddPaths(POLY.toClipper(polys), ptyp.ptClip, true);

    if (clip.Execute(ctyp.ctIntersection, ctre, cfil.pftNonZero, cfil.pftEvenOdd)) {
        for (let node of ctre.m_AllPolys) {
            poly = POLY.fromClipperNode(node, slice.z);
            for (let top of tops) {
                // use only polygons inside this top
                if (poly.isInside(top.poly)) {
                    top.fill_sparse.push(poly);
                }
            }
        }
    }
};

/**
 * Find difference between fill inset poly on two adjacent layers.
 * Used to calculate bridges, flats and then solid projections.
 * 'expand' is used for top offsets in SLA mode
 */
function doDiff(slice, options = {}) {
    const { sla, fakedown, grow, min } = options;
    if (slice.index <= 0 && !fakedown) {
        return;
    }
    const top = slice,
        down = slice.down || (fakedown ? newSlice(-1) : null),
        topInner = sla ? top.topPolys() : top.topInners(),
        downInner = sla ? down.topPolys() : down.topInners(),
        bridges = top.bridges = [],
        flats = down.flats = [];

    // skip diffing layers that are identical
    if (slice.fingerprintSame(down)) {
        top.bridges = bridges;
        down.flats = flats;
        return;
    }

    let newBridges = [];
    let newFlats = [];

    POLY.subtract(topInner, downInner, newBridges, newFlats, slice.z, min, {
        wasm: true
    });

    newBridges = newBridges.filter(p => p.areaDeep() >= min);
    newFlats = newFlats.filter(p => p.areaDeep() >= min);

    if (grow > 0 && newBridges.length) {
        newBridges = POLY.offset(newBridges, grow);
    }
    if (grow > 0 && newFlats.length) {
        newFlats = POLY.offset(newFlats, grow);
    }

    bridges.appendAll(newBridges);
    flats.appendAll(newFlats);
};

/**
 *
 *
 * @param {Polygon[]} polys
 */
function addSolidFills(slice, polys) {
    if (slice.solids) {
        slice.solids.appendAll(polys);
    } else if (polys && polys.length) {
        console.log({no_solids_in: slice, for: polys})
    }
};

/**
 * project bottom flats down
 */
function projectFlats(slice, count) {
    if (!slice.down || !slice.flats) return;
    // these flats are marked for finishing print speed
    if (slice.flats.length) slice.finishSolids = true;
    projectSolid(slice, slice.flats, count, false, true);
};

/**
 * project top bridges up
 */
function projectBridges(slice, count) {
    if (!slice.up || !slice.bridges) return;
    // these flats are marked for finishing print speed
    if (slice.bridges.length) slice.finishSolids = true;
    projectSolid(slice, slice.bridges, count, true, true);
};

/**
 * fill projected areas and store line data
 * @return {boolean} true if filled, false if not
 */
function doSolidsFill(slice, spacing, angle, minArea, fillQ) {
    let minarea = minArea || 1,
        tops = slice.tops,
        solids = slice.solids;

    if (!(tops && solids)) {
        return;
    }

    if (slice.isSolidLayer) {
        return;
    }

    let unioned = POLY.union(solids, undefined, true, { wasm: true }).flat(),
        isSLA = (spacing === undefined && angle === undefined);

    if (solids.length === 0) return false;
    if (unioned.length === 0) return false;

    let trims = [],
        inner = isSLA ? slice.topPolys() : slice.topFillOff();

    // trim each solid to the inner bounds
    for (let p of unioned) {
        p.setZ(slice.z);
        for (let i of inner) {
            let masks = p.mask(i);
            if (masks && masks.length > 0) {
                trims.appendAll(masks);
            }
        }
    }

    // clear old solids and make array for new
    tops.forEach(top => { top.solids = [] });

    // replace solids with merged and trimmed solids
    slice.solids = solids = trims;

    // parent each solid polygon inside the smallest bounding top
    let make_solid_layer = false;
    for (let solid of solids) {
        for (let top of tops) {
            let stop = [];
            if (top.poly.overlaps(solid)) {
                if (!solid.parent || solid.parent.area() > top.poly.area()) {
                    if (solid.areaDeep() < minarea) {
                        // console.log({i:slice.index,cull_solid:solid,area:solid.areaDeep()});
                        continue;
                    }
                    solid.parent = top.poly;
                    top.solids.push(solid);
                    stop.push(solid);
                }
            }
            if (stop.length) {
                let top_area = top.poly.areaDeep();
                let stop_area = stop.map(p => p.areaDeep()).reduce((a,v) => a + v);
                if (stop_area / top_area > 0.5) {
                    make_solid_layer = true;
                }
            }
        }
    }
    // if 50% of top is filled with solids, trigger layer conversion to solid
    // in future, this should be limited to a specific top, not entire layer
    if (make_solid_layer) {
        for (let top of tops) {
            top.solids = [];
        }
        doSolidLayerFill(slice, spacing, angle);
        return;
    }

    // for SLA to bypass line infill
    if (isSLA) {
        return true;
    }

    // create empty filled line array for each top
    for (let top of tops) {
        // synth belt anchor tops don't want fill
        if (!top.fill_lines) {
            continue;
        }
        const tofill = [];
        const angfill = [];
        const newfill = top.fill_lines = [];
        // determine fill orientation from top
        for (let solid of solids) {
            if (solid.parent === top.poly) {
                if (solid.fillang) {
                    angfill.push(solid);
                } else {
                    tofill.push(solid);
                }
            }
        }
        if (tofill.length > 0) {
            doFillArea(fillQ, tofill, angle, spacing, newfill);
            // top.fill_lines_norm = {angle:angle,spacing:spacing};
        }
        if (angfill.length > 0) {
            top.fill_lines_ang = {spacing:spacing,list:[],poly:[]};
            for (let af of angfill) {
                doFillArea(fillQ, [af], af.fillang.angle + 45, spacing, newfill);
                // top.fill_lines_ang.list.push(af.fillang.angle + 45);
                // top.fill_lines_ang.poly.push(af.clone());
            }
        }
    }
}

function doFillArea(fillQ, polys, angle, spacing, output, minLen, maxLen) {
    if (fillQ) {
        fillQ.push(kiri.minions.fill(polys, angle, spacing, output, minLen, maxLen));
    } else {
        POLY.fillArea(polys, angle, spacing, output, minLen, maxLen);
    }
}

/**
 * calculate external overhangs requiring support
 */
async function doSupport(slice, proc, shadow, opt = {}) {
    let maxBridge = proc.sliceSupportSpan || 5,
        minArea = proc.supportMinArea || 0.1,
        pillarSize = proc.sliceSupportSize,
        offset = proc.sliceSupportOffset || 0,
        gap = proc.sliceSupportGap,
        size = (pillarSize || 1),
        tops = slice.topPolys(),
        trimTo = tops;

    let traces = POLY.flatten(slice.topShells().clone(true)),
        fill = slice.topFill(),
        points = [],
        down = slice.down,
        down_tops = down ? down.topPolys() : null,
        down_traces = down ? POLY.flatten(down.topShells().clone(true)) : null;

    if (opt.exp && down_tops) {
        let points = down_tops.map(p => p.deepLength).reduce((a,v)=>a+v);
        if (points > 200) {
            // use de-rez'd top shadow instead
            down_tops = down.topSimples();
            // de-rez trace polys because it's not that important for supports
            down_traces = down_traces.map(p => p.clean(true, undefined, config.clipper / 10));
        }
    }

    // DEBUG code
    let SDBG = false;
    let cks = SDBG ? [] : undefined;
    let pip = SDBG ? [] : undefined;
    let pcl = SDBG ? [] : undefined;

    // check if point is supported by layer below
    function checkPointSupport(point) {
        if (SDBG) cks.push(point); // DEBUG
        // skip points close to other support points
        for (let i=0; i<points.length; i++) {
            if (point.distTo2D(points[i]) < size/4) return;
        }
        let supported = point.isInPolygonOnly(down_tops);
        if (SDBG && supported) pip.push(point); // DEBUG
        let dist = false; // DEBUG
        if (!supported) down_traces.forEach(function(trace) {
            trace.forEachSegment(function(p1, p2) {
                if (point.distToLine(p1, p2) < offset) {
                    dist = true;
                    return supported = true;
                }
            });
            return supported;
        });
        if (SDBG && dist) pcl.push(point); // DEBUG
        if (!supported) points.push(point);
    }

    // todo support entire line if both endpoints unsupported
    // segment line and check if midpoints are supported
    function checkLineSupport(p1, p2, poly) {
        let dist, i = 1;
        if ((dist = p1.distTo2D(p2)) >= maxBridge) {
            let slope = p1.slopeTo(p2).factor(1/dist),
                segs = Math.floor(dist / maxBridge) + 1,
                seglen = dist / segs;
            while (i < segs) {
                checkPointSupport(p1.projectOnSlope(slope, i++ * seglen));
            }
        }
        if (poly) checkPointSupport(p2);
    }

    let supports = [];

    // generate support polys from unsupported points
    if (slice.down) (function() {
        // check trace line support needs
        traces.forEach(function(trace) {
            trace.forEachSegment(function(p1, p2) { checkLineSupport(p1, p2, true) });
        });

        // add offset solids to supports (or fill depending)
        fill.forEachPair(function(p1,p2) { checkLineSupport(p1, p2, false) });

        // skip the rest if no points or supports
        if (!(points.length || supports.length)) return;

        let pillars = [];

        // for each point, create a bounding rectangle
        points.forEach(function(point) {
            pillars.push(base.newPolygon().centerRectangle(point, size/2, size/2));
        });

        supports.appendAll(POLY.union(pillars, null, true, { wasm: false }));
        // merge pillars and replace with convex hull of outer points (aka smoothing)
        pillars = POLY.union(pillars, null, true, { wasm: false }).forEach(function(pillar) {
            supports.push(base.newPolygon().createConvexHull(pillar.points));
        });
    })();

    // DEBUG code
    if (SDBG && down_traces) slice.output()
        .setLayer('cks', { line: 0xee5533, check: 0xee5533 })
        .addPolys(cks.map(p => base.newPolygon().centerRectangle(p, 0.25, 0.25)))
        .setLayer('pip', { line: 0xdd4422, check: 0xdd4422 })
        .addPolys(pip.map(p => base.newPolygon().centerRectangle(p, 0.4, 0.4)))
        .setLayer('pcl', { line: 0xcc3311, check: 0xcc3311 })
        .addPolys(pcl.map(p => base.newPolygon().centerRectangle(p, 0.3, 0.3)))
        .setLayer('pts', { line: 0xdd33dd, check: 0xdd33dd })
        .addPolys(points.map(p => base.newPolygon().centerRectangle(p, 0.8, 0.8)))
        .setLayer('dtr', { line: 0x0, check: 0x0 })
        .addPolys(POLY.setZ(down_traces.clone(true),slice.z));
        ;

    if (supports.length === 0) {
        return;
    }

    // then union supports
    if (supports.length > 10) {
        supports = await kiri.minions.union(supports);
    } else {
        supports = POLY.union(supports, null, true, { wasm: false });
    }

    // clip to top polys
    supports = POLY.trimTo(supports, shadow);

    let depth = 0;
    while (down && supports.length > 0) {
        down.supports = down.supports || [];

        let trimmed = [], culled = [];

        // culled = supports;
        // clip supports to shell offsets
        POLY.subtract(supports, down.topSimples(), trimmed, null, slice.z, minArea, { wasm: false });

        // set depth hint on support polys for infill density
        trimmed.forEach(function(trim) {
            if (trim.area() < minArea) return;
            culled.push(trim.setZ(down.z));
        });

        // exit when no more support polys exist
        if (culled.length === 0) break;

        // new bridge polys for next pass (skip first layer below)
        if (depth >= gap) {
            down.supports.appendAll(culled);
        }

        supports = culled;
        down = down.down;
        depth++;
    }

}

function doSupportFill(promises, slice, linewidth, density, minArea, isBelt) {
    let supports = slice.supports,
        nsB = [],
        nsC = [],
        min = minArea || 0.1;

    if (!supports) return;

    // union supports
    supports = POLY.setZ(POLY.union(supports, undefined, true, { wasm: false }), slice.z);

    // clip supports to slice clip offset (or shell if none)
    POLY.subtract(supports, slice.clips, nsB, null, slice.z, min, { wasm: false });
    supports = nsB;

    // also trim to lower offsets, if they exist
    if (slice.down && slice.down.clips) {
        POLY.subtract(nsB, slice.down.clips, nsC, null, slice.z, min, { wasm: false });
        supports = nsC;
    }

    if (supports) {
        fillSupportPolys(promises, supports, linewidth, density, slice.z, isBelt);
    }

    // re-assign new supports back to slice
    slice.supports = supports;
};

function fillSupportPolys(promises, polys, linewidth, density, z, isBelt) {
    // calculate fill density
    let spacing = linewidth * (1 / density);
    polys.forEach(function (poly) {
        // angle based on width/height ratio
        let angle = isBelt || (poly.bounds.width() / poly.bounds.height() > 1) ? 90 : 0;
        // inset support poly for fill lines 33% of nozzle width
        let inset = POLY.offset([poly], -linewidth/3, {flat: true, z, wasm: true});
        // do the fill
        if (inset && inset.length > 0) {
            doFillArea(promises, inset, angle, spacing, poly.fill = []);
        }
        return true;
    });
}

/**
 *
 * @param {Slice} slice
 * @param {Polygon[]} polys
 * @param {number} count
 * @param {boolean} up
 * @param {boolean} first
 * @returns {*}
 */
function projectSolid(slice, polys, count, up, first) {
    if (!slice || count <= 0) {
        return;
    }
    let clones = polys.clone(true);
    if (first) {
        clones.forEach(function(p) {
            p.hintFillAngle();
        });
    }
    addSolidFills(slice, clones);
    if (count > 0) {
        if (up) projectSolid(slice.up, polys, count-1, true, false);
        else projectSolid(slice.down, polys, count-1, false, false);
    }
}

FDM.supports = function(settings, widget) {
    let isBelt = settings.device.bedBelt;
    let process = settings.process;
    let size = process.sliceSupportSize;
    let s4 = size / 4;
    let s2 = size * 0.45;
    let min = 0.01;
    let geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(widget.vertices, 3));
    let mat = new THREE.MeshBasicMaterial();
    let rad = (Math.PI / 180);
    let deg = (180 / Math.PI);
    let angle = rad * settings.process.sliceSupportAngle;
    let thresh = -Math.sin(angle);
    let dir = new THREE.Vector3(0,0,-1)
    let add = [];
    let mesh = new THREE.Mesh(geo, mat);
    let platform = new THREE.Mesh(
        new THREE.PlaneGeometry(1000,1000,1), mat
    );
    function pointIn(x, y, p1, p2, p3) {
        let det = (p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x)
        return det * ((p2.x - p1.x) * (y - p1.y) - (p2.y - p1.y) * (x - p1.x)) > 0 &&
            det * ((p3.x - p2.x) * (y - p2.y) - (p3.y - p2.y) * (x - p2.x)) > 0 &&
            det * ((p1.x - p3.x) * (y - p3.y) - (p1.y - p3.y) * (x - p3.x)) > 0
    }
    // first, last, distance
    function fld(arr, key) {
        let first = arr[0];
        let last = arr.last();
        let dist = last[key] - first[key];
        return { first, last, dist }
    }
    // sorted range distance from key
    function rdist(range, key) {
        return range.last[key] - range.first[key];
    }
    // test area
    function ta(p1, p2, p3) {
        let sortx = [p1,p2,p3].sort((a,b) => { return a.x - b.x });
        let sorty = [p1,p2,p3].sort((a,b) => { return a.y - b.y });
        let sortz = [p1,p2,p3].sort((a,b) => { return a.z - b.z });
        let xv = fld(sortx, 'x');
        let yv = fld(sorty, 'y');
        let xa = base.util.lerp(xv.first.x + s4, xv.last.x - s4, s2, true);
        let ya = base.util.lerp(yv.first.y + s4, yv.last.y - s4, s2, true);
        for (let x of xa) {
            for (let y of ya) {
                if (pointIn(x, y, p1, p2, p3)) {
                    let z = base.util.zInPlane(p1, p2, p3, x, y);
                    tp(new THREE.Vector3(x, y, z));
                }
            }
        }
    }
    // test poly
    function tP(poly, face) {
        let bounds = poly.bounds;
        let xa = base.util.lerp(bounds.minx + s4, bounds.maxx - s4, s2, true);
        let ya = base.util.lerp(bounds.miny + s4, bounds.maxy - s4, s2, true);
        for (let x of xa) {
            for (let y of ya) {
                if (base.newPoint(x, y, 0).isInPolygon(poly)) {
                    let z = base.util.zInPlane(face[0], face[1], face[2], x, y);
                    tp(new THREE.Vector3(x, y, z));
                }
            }
        }
    }
    // test point
    function tp(point) {
        if (point.added) {
            return;
        }
        // omit pillars close to existing pillars
        for (let added of add) {
            let p2 = new THREE.Vector2(point.x, point.y);
            let pm = new THREE.Vector2(added.mid.x, added.mid.y);
            if (Math.abs(point.z - added.from.z) < s2 && p2.distanceTo(pm) < s4) {
                return;
            }
        }
        let ray = new THREE.Raycaster(point, dir);
        let int = ray.intersectObjects([ mesh, platform ], false);
        if (int && int.length && int[0].distance > 0.5) {
            let mid = new THREE.Vector3().add(point).add(int[0].point).divideScalar(2);
            add.push({from: point, to: int[0].point, mid});
            point.added = true;
        }
    }
    let filter = isBelt ? (norm) => {
        return norm.z <= thresh && norm.y < 0;
    } : (norm) => {
        return norm.z < thresh;
    };
    let { position } = geo.attributes;
    let { itemSize, count, array } = position;
    let v3cache = new Vector3Cache();
    let coplane = new Coplanars();
    for (let i = 0; i<count; i += 3) {
        let ip = i * itemSize;
        let a = v3cache.get(array[ip++], array[ip++], array[ip++]);
        let b = v3cache.get(array[ip++], array[ip++], array[ip++]);
        let c = v3cache.get(array[ip++], array[ip++], array[ip++]);
        let norm = THREE.computeFaceNormal(a,b,c);
        // limit to downward faces
        if (!filter(norm)) {
            continue;
        }
        // skip tiny faces
        let poly = base.newPolygon().addPoints([a,b,c].map(v => base.newPoint(v.x, v.y, v.z)));
        if (poly.area() < min && poly.perimeter() < size) {
            continue;
        }
        // skip faces on bed
        if (a.z + b.z + c.z < 0.01) {
            continue;
        }
        // match with other attached, coplanar faces
        coplane.put(a, b, c, norm.z);
    }
    let groups = coplane.group(true);
    // console.log({v3cache, coplane, groups});
    // let ptotl = Object.values(groups).flat().flat().length;
    // console.log({ptotl});
    // let pdone = 0;
    for (let group of Object.values(groups)) {
        for (let polys of group) {
            for (let poly of polys) {
                if (poly.area() >= process.sliceSupportArea)
                tP(poly, polys.face);
                // console.log(++pdone / ptotl);
            }
        }
    }

    widget.supports = add;
    return add.length > 0;
};

class Vector3Cache {
    constructor() {
        this.cache = {};
    }

    get(x, y, z) {
        let key = [x.round(4),y.round(4),z.round(4)].join(',');
        let val = this.cache[key];
        if (!val) {
            val = new THREE.Vector3(x, y, z);
            this.cache[key] = val;
        }
        return val;
    }
}

class Coplanars {
    constructor() {
        this.cache = {};
    }

    put(a, b, c, norm) {
        let key = norm.round(7).toString();
        let arr = this.cache[key];
        if (!arr) {
            arr = [];
            this.cache[key] = arr;
        }
        arr.push([a,b,c]);
    }

    group(union) {
        let out = {};
        for (let norm in this.cache) {
            let arr = this.cache[norm];
            let groups = [];
            for (let face of arr) {
                let match = undefined;
                // see if face matches vertices in any group
                outer: for (let group of groups) {
                    for (let el of group) {
                        if (
                            el.indexOf(face[0]) >= 0 ||
                            el.indexOf(face[1]) >= 0 ||
                            el.indexOf(face[2]) >= 0
                        ) {
                            match = group;
                            break outer;
                        }
                    }
                }
                if (match) {
                    match.push(face);
                } else {
                    groups.push([face]);
                }
            }
            if (union) {
                // convert groups of faces to contiguous polygon groups
                groups = groups.map(group => {
                    let parr = group.map(arr => {
                        return base.newPolygon()
                            .add(arr[0].x, arr[0].y, arr[0].z)
                            .add(arr[1].x, arr[1].y, arr[1].z)
                            .add(arr[2].x, arr[2].y, arr[2].z);
                    });
                    let union = parr.length === 1 ? parr :
                        POLY.union(parr, 0, true, {wasm:false});
                    union.merged = parr.length;
                    union.face = group[0];
                    return union;
                });
            }
            out[norm] = groups;
        }
        // console.log(out);
        return out;
    }
}

});
