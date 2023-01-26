/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

"use strict";

// dep: geo.base
// dep: geo.mesh
// dep: geo.point
// dep: geo.points
// dep: geo.polygons
// dep: kiri.utils
// use: kiri.codec
gapp.register("kiri.widget", [], (root, exports) => {

const { base, kiri } = root;
const { api, driver, utils } = kiri;
const { config, util, polygons } = base;
const { Mesh, newPoint, verticesToPoints } = base;
const { inRange, time } = util;
const { rgb, avgc } = utils;

const POLY = polygons;
const solid_opacity = 1.0;
const groups = [];

let nextId = 0;

function newWidget(id,group) { return new Widget(id,group) }

function catalog() { return kiri.catalog }

function index() { return catalog().index }

class Widget {
    constructor(id, group) {
        this.id = id || new Date().getTime().toString(36)+(nextId++);
        this.grouped = group ? true : false;
        this.group = group || [];
        this.group.push(this);
        if (!this.group.id) {
            this.group.id = this.id;
        }
        if (groups.indexOf(this.group) < 0) {
            groups.push(this.group);
        }
        // rotation stack (for undo)
        this.roto = [];
        // added meshes (supports, tabs, etc)
        this.adds = [];
        // persisted client annotations (cam tabs, fdm supports)
        this.anno = {};
        // THREE Mesh and points
        this.mesh = null;
        this.points = null;
        // todo resolve use of this vs. mesh.bounds
        this.bounds = null;
        // wireframe
        this.wire = null;
        this.slices = null;
        this.settings = null;
        this.modified = true;
        this.track = {
            // box size for packer
            box: {
                w: 0,
                h: 0,
                d: 0
            },
            scale: {
                x: 1.0,
                y: 1.0,
                z: 1.0
            },
            rot: {
                x: 0,
                y: 0,
                z: 0
            },
            pos: {
                x: 0,
                y: 0,
                z: 0
            },
            top: 0, // z top
            mirror: false
        },
        this.cache = {};
        this.stats = {
            slice_time: 0,
            load_time: 0,
            progress: 0
        };
        this.meta = {
            url: null,
            file: null,
            saved: false
        };

        // LWW
        this.surrogate_data = {
            timestamp: Date.now(),
            surrogating_duration: 0,
            combined_total_duration: 0
        }

        // if this is a synthesized support widget
        this.support = false;
    }

    saveToCatalog(filename) {
        if (this.grouped) {
            return this;
        }
        const widget = this;
        const mark = time();
        widget.meta.file = filename;
        widget.meta.save = mark;
        catalog().putFile(filename, this.getGeoVertices(true), vertices => {
            if (vertices && vertices.length) {
                console.log("saving decimated mesh ["+vertices.length+"] time ["+(time()-mark)+"]");
                widget.loadVertices(vertices);
            }
        });
        return this;
    }

    saveState(ondone) {
        if (!ondone) {
            clearTimeout(this._save_timer);
            this._save_timer = setTimeout(() => {
                this._save_timer = undefined;
                this.saveState(() => {});
            }, 1500);
            return;
        }
        const widget = this;
        index().put('ws-save-'+this.id, {
            geo: widget.getGeoVertices(false),
            ind: widget.getGeoIndices(),
            track: widget.track,
            group: this.group.id,
            meta: this.meta,
            anno: this.annotations()
        }, result => {
            widget.meta.saved = time();
            if (ondone) ondone();
        });
    }

    annotations() {
        let o = Object.clone(this.anno);
        if (o.support) {
            // clear out THREE.Box temps
            for (let s of o.support) {
                delete s.box;
            }
        }
        return o;
    }

    /**
     *
     * @param {Float32Array} vertices
     * @returns {Widget}
     */
    loadVertices(data, options = { index: false }) {
        let vertices,
            indices,
            autoscale = false;
        if (ArrayBuffer.isView(data) || typeof(data) != 'object') {
            vertices = data;
        } else {
            vertices = data.vertices;
            indices = data.indices;
        }
        switch (typeof(autoscale)) {
            case 'boolean':
                autoscale = options;
                break;
            case 'object':
                autoscale = options.autoscale;
                break;
        }
        if (!vertices) {
            console.log('missing vertices', {data, options});
            return;
        }
        if (autoscale === true) {
            // onshape exports obj in meters by default :/
            let maxv = 0;
            for (let i=0; i<vertices.length; i++) {
                maxv = Math.max(maxv,Math.abs(vertices[i]));
            }
            if (maxv < 1) {
                for (let i=0; i<vertices.length; i++) {
                    vertices[i] *= 1000;
                }
            }
        }
        if (options.index && !indices) {
            let mesh = new Mesh({vertices});
            vertices = mesh.vertices.toFloat32();
            indices = Uint32Array.from(mesh.faces.map(v => v/3));
        }
        if (this.mesh) {
            let geo = this.mesh.geometry;
            if (indices) geo.setIndex(new THREE.BufferAttribute(indices, 1));
            geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
            geo.setAttribute('normal', undefined);
            geo.attributes.position.needsUpdate = true;
            // geo.computeFaceNormals();
            geo.computeVertexNormals();
            this.meta.vertices = vertices.length / 3;
            this.points = null;
            return this;
        } else {
            let geo = new THREE.BufferGeometry();
            if (indices) geo.setIndex(new THREE.BufferAttribute(indices, 1));
            geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
            geo.setAttribute('normal', undefined);
            this.meta.vertices = vertices.length / 3;
            this.points = null;
            return this.loadGeometry(geo);
        }
    }

    loadData() {
        return this.loadVertices(...arguments);
    }

    setModified() {
        this.modified = true;
        if (this.mesh && this.mesh.geometry) {
            // this fixes ray intersections after the mesh is modified
            this.mesh.geometry.boundingSphere = null;
        }
    }

    indexGeo() {
        let indices = this.getGeoIndices();
        if (!indices) {
            let mesh = new Mesh({vertices: this.getGeoVertices()});
            vertices = mesh.vertices.toFloat32();
            indices = Uint32Array.from(mesh.faces.map(v => v/3));
            this.loadData({vertices, indices});
        }
    }

    heal(debug, refresh) {
        if (debug) {
            let mesh = this.debugMesh().heal();
            let verts = mesh.vertices;
            let edges = mesh.edges;
            let split = mesh.edges.filter(l => l.split);
            let layrz = new kiri.Layers();
            layrz.setLayer("edges", {line: 0});
            for (let line of edges) {
                layrz.addLine(
                    newPoint(verts[line.v1], verts[line.v1+1], verts[line.v1+2]),
                    newPoint(verts[line.v2], verts[line.v2+1], verts[line.v2+2])
                );
            }
            for (let l=0; l<mesh.loops.length; l++) {
                layrz.setLayer(`loop ${l}`, {line: [ 0xff0000, 0x00ff00, 0x0000ff ][l % 3]});
                let zo = [0.15, 0.3, 0.45][l % 3];
                for (let line of mesh.loops[l]) {
                    layrz.addLine(
                        newPoint(verts[line.v1], verts[line.v1+1], verts[line.v1+2] - zo),
                        newPoint(verts[line.v2], verts[line.v2+1], verts[line.v2+2] - zo)
                    );
                }
            }
            layrz.setLayer("split", {line: 0xff00ff});
            for (let line of split) {
                layrz.addLine(
                    newPoint(verts[line.v1], verts[line.v1+1], verts[line.v1+2] - 0.6),
                    newPoint(verts[line.v2], verts[line.v2+1], verts[line.v2+2] - 0.6)
                );
            }
            let stack = new kiri.Stack(this.mesh);
            stack.addLayers(layrz);
            return { mesh, layrz, stack };
        }
        return new Promise((resolve, reject) => {
            kiri.client.heal(this.getVertices().array, data => {
                if (data.vertices) {
                    this.loadVertices(data.vertices);
                    this.modified = true;
                } else {
                    this.modified = false;
                }
                resolve(this.modified);
            }, refresh);
        });
    }

    debugMesh(precision) {
        return new base.Mesh({precision, vertices: this.getVertices().array});
    }

    getVertices() {
        return this.mesh.geometry.attributes.position;
    }

    /**
     * @param {THREE.Geometry} geometry
     * @returns {Widget}
     */
    loadGeometry(geometry) {
        const mesh = new THREE.Mesh(
            geometry,
            new THREE.MeshPhongMaterial({
                color: 0xffff00,
                specular: 0x202020,
                shininess: 125,
                transparent: true,
                opacity: solid_opacity
            })
        );
        mesh.renderOrder = 1;
        // fix invalid normals
        // geometry.computeFaceNormals();
        geometry.computeVertexNormals();
        mesh.material.side = THREE.DoubleSide;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.widget = this;
        this.mesh = mesh;
        // invalidates points cache (like any scale/rotation)
        this.center(true);
        return this;
    }

    groupBounds() {
        return Group.bounds(this.group);
    }

    /**
     * @param {Point[]} points
     * @returns {Widget}
     */
    setPoints(points) {
        this.points = points || null;
        return this;
    }

    /**
     * remove slice data and their views
     */
    clearSlices() {
        let slices = this.slices,
            mesh = this.mesh;
        if (slices && mesh && mesh.remove) {
            slices.forEach(function(slice) {
                mesh.remove(slice.view);
            });
        }
        this.slices = null;
    }

    /**
     * @param {number} color
     */
    setColor(color, settings, save = true) {
        if (settings) {
            console.trace('legacy call with settings');
        }
        if (Array.isArray(color)) {
            color = color[this.getExtruder() % color.length];
        }
        if (save) {
            this.color = color;
        }
        let material = this.mesh.material;
        material.color.set(this.meta.disabled ? avgc(0x888888, color, 3) : color);
    }

    getColor() {
        return this.color;
    }

    /**
     * @param {number} value
     */
    setOpacity(value) {
        const mesh = this.mesh;
        if (value <= 0.0) {
            mesh.material.transparent = solid_opacity < 1.0;
            mesh.material.opacity = solid_opacity;
            mesh.material.visible = false;
        } else if (inRange(value, 0.0, solid_opacity)) {
            mesh.material.transparent = value < 1.0;
            mesh.material.opacity = value;
            mesh.material.visible = true;
        }
    }


    // // LWW
    // /**
    //  * @param {number} surrogate_duration
    //  * @param {number} total_combined_duration
    //  */
    // setSurrogateData = function(surrogate_duration,total_combined_duration) {
    //     this.surrogate_data.surrogating_duration = surrogate_duration;
    //     this.surrogate_data.combined_total_duration = total_combined_duration;
    // };

    // LWW
    /**
     * @param {number} surrogate_duration
     * @param {number} total_combined_duration
     */
    setSurrogateData = function(surrogate_duration,total_combined_duration) {
        this.surrogate_data.surrogating_duration = surrogate_duration;
        this.surrogate_data.combined_total_duration = total_combined_duration;
    };

    // // LWW
    // /**
    //  * @param {number} surrogate_duration
    //  * @param {number} total_combined_duration
    // */
    // setSurrogateData(surrogate_duration,total_combined_duration) {
    //     this.surrogate_data.surrogating_duration = surrogate_duration;
    //     this.surrogate_data.combined_total_duration = total_combined_duration;
    // };


    // // LWW
    // /**
    //  * @param {number} surrogate_duration
    //  * @param {number} total_combined_duration
    // */
    // setSurrogateData(surrogate_duration,total_combined_duration) {
    //     this.surrogate_data.surrogating_duration = surrogate_duration;
    //     this.surrogate_data.combined_total_duration = total_combined_duration;
    // };

    /**
     * center geometry bottom (on platform) at 0,0,0
     */
    center(init) {
        let bb = init ? this.mesh.getBoundingBox(true) : this.groupBounds(),
            bm = bb.min.clone(),
            bM = bb.max.clone(),
            bd = bM.sub(bm).multiplyScalar(0.5),
            dx = bm.x + bd.x,
            dy = bm.y + bd.y,
            dz = bm.z;
        this.track.center = { dx, dy, dz };
        // move mesh for each widget in group
        if (!init) {
            this.group.forEach(w => {
                w.moveMesh(dx,dy,dz);
            });
        }
        return this;
    }

    /**
     * called by center() and Group.center()
     * todo use new prototype.moveMesh()
     */
    moveMesh(x, y, z) {
        let gap = this.mesh.geometry.attributes.position,
            pa = gap.array;
        // center point array on 0,0,0
        for (let i=0; i < pa.length; i += 3) {
            pa[i    ] -= x;
            pa[i + 1] -= y;
            pa[i + 2] -= z;
        }
        gap.needsUpdate = true;
        let bb = this.groupBounds();
        // critical to layout and grouping
        this.track.box = {
            w: (bb.max.x - bb.min.x),
            h: (bb.max.y - bb.min.y),
            d: (bb.max.z - bb.min.z)
        };
        // for use with the packer
        // invalidate cached points
        this.points = null;
        this.setModified();
    }

    /**
     * moves top of widget to given Z
     *
     * @param {number} z position
     */
    setTopZ(z) {
        let mesh = this.mesh,
            pos = this.track.pos,
            ltz = this.last_top_z || {},
            mbz = mesh.getBoundingBox().max.z;
        if (z) {
            pos.z = mbz - z;
            mesh.position.z = -pos.z - 0.01;
            this.track.top = z;
        } else {
            pos.z = 0;
            mesh.position.z = -this.track.zcut || 0;
            this.track.top = mbz;
        }
        let ntz = {
            pz: pos.z,
            mpz: mesh.position.z
        };
        this.modified |= (ltz.pz !== ntz.pz || ltz.mpz !== ntz.mpz);
        this.last_top_z = ntz;
    }

    cutZ(dist) {
        this.track.zcut = dist;
        this.setTopZ();
    }

    move(x, y, z, abs) {
        this.group.forEach(w => {
            w._move(x, y, z, abs);
        });
    }

    _move(x, y, z, abs) {
        let mesh = this.mesh,
            pos = this.track.pos,
            zcut = this.track.zcut || 0;
            // do not allow moves in pure slice view
        if (!mesh.material.visible) return;
        if (abs) {
            mesh.position.set(x, y, z - zcut);
            pos.x = (x || 0);
            pos.y = (y || 0);
            pos.z = (z || 0);
        } else {
            mesh.position.x += ( x || 0);
            mesh.position.y += ( y || 0);
            mesh.position.z += (-z || 0);
            pos.x += (x || 0);
            pos.y += (y || 0);
            pos.z += (z || 0);
        }
        if (x || y || z) {
            this.setModified();
            // allow for use in engine / cli
            if (api && api.event) {
                api.event.emit('widget.move', {widget: this, pos});
            }
        }
    }

    scale(x, y, z) {
        this.group.forEach(w => {
            w._scale(x, y, z);
        });
        this.center();
    }

    _scale(x, y, z) {
        let mesh = this.mesh,
            scale = this.track.scale;
        this.bounds = null;
        this.setWireframe(false);
        this.clearSlices();
        mesh.geometry.applyMatrix4(new THREE.Matrix4().makeScale(x, y, z));
        scale.x *= (x || 1.0);
        scale.y *= (y || 1.0);
        scale.z *= (z || 1.0);
        this.setModified();
    }

    rotate(x, y, z, temp) {
        this.group.forEach(w => {
            w._rotate(x, y, z, temp);
        });
        this.center(false);
    }

    rotateRaw(x, y, z, temp) {
        this.group.forEach(w => {
            w._rotate(x, y, z, temp);
        });
    }

    _rotate(x, y, z, temp) {
        if (!temp) {
            this.bounds = null;
            this.setWireframe(false);
            this.clearSlices();
        }
        let m4 = new THREE.Matrix4();
        let euler = typeof(x) === 'number';
        if (euler) {
            m4 = m4.makeRotationFromEuler(new THREE.Euler(x || 0, y || 0, z || 0));
        } else {
            m4 = m4.makeRotationFromQuaternion(x);
        }
        this.roto.push(m4);
        this.mesh.geometry.applyMatrix4(m4);
        if (!temp && euler) {
            let rot = this.track.rot;
            rot.x += (x || 0);
            rot.y += (y || 0);
            rot.z += (z || 0);
        }
        this.setModified();
    }

    unrotate() {
        this.roto.reverse().forEach(m => {
            this.mesh.geometry.applyMatrix4(m.clone().invert());
        });
        this.roto = [];
        this.center();
        this.setModified();
    }

    mirror() {
        this.group.forEach(w => {
            w._mirror();
        });
        this.center();
    }

    _mirror() {
        this.clearSlices();
        this.setWireframe(false);
        let geo = this.mesh.geometry, ot = this.track;
        let pos = geo.attributes.position;
        let arr = pos.array;
        let count = pos.count;
        // invert x
        for (let i=0; i<count; i++) {
            arr[i*3] = -arr[i*3];
        }
        // invert face vertex order
        for (let i=0; i<count; i+=3) {
            let x = arr[i*3+0];
            let y = arr[i*3+1];
            let z = arr[i*3+2];
            arr[i*3+0] = arr[i*3+6];
            arr[i*3+1] = arr[i*3+7];
            arr[i*3+2] = arr[i*3+8];
            arr[i*3+6] = x;
            arr[i*3+7] = y;
            arr[i*3+8] = z;
        }
        pos.needsUpdate = true;
        // geo.computeFaceNormals();
        geo.computeVertexNormals();
        ot.mirror = !ot.mirror;
        this.setModified();
        this.points = null;
    }

    getGeoVertices(unroll) {
        let geo = this.mesh.geometry;
        let pos = geo.getAttribute('position').array;
        if (geo.index && unroll !== false) {
            let idx = geo.index.array;
            let len = idx.length;
            let p2 = new Float32Array(len * 3);
            let inc = 0;
            for (let i=0; i<len; i++) {
                let iv = idx[i];
                let ip = iv * 3;
                p2[inc++] = pos[ip++];
                p2[inc++] = pos[ip++];
                p2[inc++] = pos[ip];
            }
            return p2;
        } else {
            return pos;
        }
    }

    getGeoIndices() {
        let indices = this.mesh.geometry.index;
        return indices ? indices.array : undefined;
    }

    iterPoints() {
        let verts = this.getGeoVertices();
        let index = 0;
        let count = verts.length;
        return new class ITER {
            [Symbol.iterator]() { return {
                next: () => {
                    let done = index >= count;
                    return done ? { done } :
                        { value: newPoint(verts[index++], verts[index++], verts[index++]) };
                }
            } }
        };
    }

    getPoints() {
        if (!this.points) {
            // convert and cache points from geometry vertices
            this.points = verticesToPoints(this.getGeoVertices(), {
                maxpass: 0 // disable decimation
            });
        }
        return this.points;
    }

    getBoundingBox(refresh) {
        if (!this.bounds || refresh) {
            this.bounds = new THREE.Box3();
            this.bounds.setFromPoints(this.getPoints());
        }
        return this.bounds;
    }

    getPositionBox() {
        let bounds = this.getBoundingBox().clone();
        let pos = this.track.pos;
        bounds.min.x += pos.x;
        bounds.max.x += pos.x;
        bounds.min.y += pos.y;
        bounds.max.y += pos.y;
        return bounds;
    }

    isModified() {
        return this.modified;
    }

    getExtruder(settings) {
        if (settings) {
            console.trace('legacy call with settings');
        }
        return this.anno.extruder || 0;
    }

    // allow worker code to run in same memspace as client
    setInWorker() {
        this.inWorker = true;
        return this;
    }

    /**
     * processes points into facets, then into slices
     *
     * once upon a time there were multiple slicers. this was the fastest in most cases.
     * lines are added to all the buckets they cross. then buckets are processed in order.
     * buckets are contiguous ranges of z slicers. the advantage of this method is that
     * as long as a large percentage of lines do not cross large z distances, this reduces
     * the number of lines each slice has to consider thus improving speed.
     *
     * @params {Object} settings
     * @params {Function} [ondone]
     * @params {Function} [onupdate]
     */
    slice(settings, ondone, onupdate) {
        let widget = this;
        let startTime = time();

        widget.settings = settings;
        widget.clearSlices();
        onupdate(0.0001, "slicing");

        if (kiri.client && !widget.inWorker) {
            // in case result of slice is nothing, do not preserve previous
            widget.slices = []

            // executed from kiri.js
            kiri.client.slice(settings, this, function(reply) {
                if (reply.update) {
                    onupdate(reply.update, reply.updateStatus);
                }
                if (reply.send_start) {
                    widget.xfer = {start: reply.send_start};
                }
                if (reply.stats) {
                    widget.stats = reply.stats;
                }
                if (reply.send_end) {
                    widget.stats.load_time = widget.xfer.start - reply.send_end;
                }
                if (reply.slice) {
                    widget.slices.push(kiri.codec.decode(reply.slice, {mesh:widget.mesh}));
                }
                if (reply.rotinfo) {
                    widget.rotinfo = reply.rotinfo;
                }
                if (reply.done) {
                    ondone(true);
                }
                if (reply.error) {
                    ondone(false, reply.error);
                }
                if (reply.log) {
                    // api.event.emit('log.fileDetail', reply.log);
                }
                if (reply.pso_history) {
                    // api.event.emit('log.pso_history', reply.pso_history);
                }
                if (reply.basicGeometryExport) {
                    // console.log({reply:reply.basicGeometryExport});
                    // api.event.emit('log.basicGeometryExport', reply.basicGeometryExport); //visualize_output
                }
            });
        }

        if (kiri.server) {
            // executed from kiri-worker.js
            let catchdone = function(error) {
                if (error) {
                    return ondone(error);
                }

                onupdate(1.0, "transfer");

                widget.stats.slice_time = time() - startTime;

                ondone();
            };

            let catchupdate = function(progress, message) {
                onupdate(progress, message);
            };

            let drv = driver[settings.mode.toUpperCase()];

            if (drv) {
                drv.slice(settings, widget, catchupdate, catchdone);
            } else {
                console.log('invalid mode: '+settings.mode);
                ondone('invalid mode: '+settings.mode);
            }
        }

        // discard point cache
        widget.points = undefined;
    }

    /**
     * render to provided stack
     */
    render(stack) {
        const mark = Date.now();
        this.slices.forEach(slice => {
            if (slice.layers) {
                stack.add(slice.layers);
            }
        });
        return Date.now() - mark;
    }

    setWireframe(set, color, opacity) {
        if (!(api && api.conf)) {
            // missing api features in engine mode
            return;
        }
        let mesh = this.mesh,
            widget = this;
        if (this.wire) {
            this.setOpacity(solid_opacity);
            mesh.remove(this.wire);
            this.wire = null;
        }
        if (set) {
            let dark = api.space.is_dark();
            let mat = new THREE.MeshBasicMaterial({
                wireframe: true,
                color: dark ? 0xaaaaaa : 0,
                opacity: 0.5,
                transparent: true
            })
            let wire = widget.wire = new THREE.Mesh(mesh.geometry.shallowClone(), mat);
            mesh.add(wire);
        }
        if (api.view.is_arrange()) {
            this.setColor(this.color);
        } else {
            this.setColor(0x888888,undefined,false);
        }
        if (opacity !== undefined) {
            widget.setOpacity(opacity);
        }
    }

    show() {
        this.mesh.visible = true;
    }

    hide() {
        this.mesh.visible = false;
    }
}

// Widget Grouping API
const Group = Widget.Groups = {
    list() {
        return groups.slice()
    },

    merge(widgets) {
        let grps = widgets.map(w => w.group).uniq();
        if (grps.length > 1) {
            let root = grps.shift();
            let rpos = root[0].track.pos;
            for (let grp of grps) {
                for (let w of grp) {
                    let wpos = w.track.pos;
                    w.group = root;
                    w.moveMesh(rpos.x - wpos.x, rpos.y - wpos.y, rpos.z - wpos.z);
                    w._move(rpos.x, rpos.y, rpos.z, true);
                    root.push(w);
                }
                groups.splice(groups.indexOf(grp),1);
            }
        }
    },

    split(widgets) {
        for (let group of widgets.map(w => w.group).uniq()) {
            groups.splice(groups.indexOf(group),1);
            for (let widget of group) {
                let nugroup = Group.forid(widget.id);
                nugroup.push(widget);
                widget.group = nugroup;
            }
        }
    },

    forid(id) {
        for (let i=0; i<groups.length; i++) {
            if (groups[i].id === id) return groups[i];
        }
        let group = [];
        group.id = id;
        groups.push(group);
        return group;
    },

    remove(widget) {
        groups.slice().forEach(group => {
            let pos = group.indexOf(widget);
            if (pos >= 0) {
                group.splice(pos,1);
            }
            if (group.length === 0) {
                pos = groups.indexOf(group);
                groups.splice(pos,1);
            }
        });
    },

    blocks() {
        return groups.map(group => {
            return {
                w: group[0].track.box.w,
                h: group[0].track.box.h,
                move: (x,y,z,abs) => {
                    group.forEach(widget => {
                        widget.mesh.material.visible = true;
                        widget._move(x, y, z, abs);
                    });
                }
            };
        });
    },

    loadDone() {
        groups.forEach(group => {
            if (!group.centered) {
                group[0].center();
                group.centered = true;
            }
        });
    },

    bounds(group) {
        let bounds = null;
        group.forEach(widget => {
            let wb = widget.mesh.getBoundingBox(true);
            if (bounds) {
                bounds = bounds.union(wb);
            } else {
                bounds = wb;
            }
        });
        return bounds;
    },

    clear() {
        groups.length = 0;
    }
};

Widget.loadFromCatalog = function(filename, ondone) {
    catalog().getFile(filename, function(data) {
        let widget = newWidget().loadVertices(data);
        widget.meta.file = filename;
        ondone(widget);
    });
};

Widget.loadFromState = function(id, ondone, move) {
    index().get('ws-save-'+id, function(data) {
        if (data) {
            let vertices = data.geo || data,
                indices = data.ind || undefined,
                track = data.track || undefined,
                group = data.group || id,
                anno = data.anno || undefined,
                widget = newWidget(id, Group.forid(group)),
                meta = data.meta || widget.meta,
                ptr = widget.loadVertices({vertices, indices});
            widget.meta = meta;
            widget.anno = anno || widget.anno;
            // restore widget position if specified
            if (move && track && track.pos) {
                widget.track = track;
                widget.move(track.pos.x, track.pos.y, track.pos.z, true);
            }
            ondone(ptr);
        } else {
            ondone(null);
        }
    });
};

Widget.deleteFromState = function(id,ondone) {
    index().remove('ws-save-'+id, ondone);
};

kiri.Widget = Widget;
kiri.newWidget = newWidget;

});
