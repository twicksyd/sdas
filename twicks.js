/* Twicks — Single-file build (index/forsale/sold/cash)
   Goals:
   - One JavaScript file, no ES module imports
   - Namespaced architecture (TWX.*) for maintainability
   - Async-safe storage: localStorage with IndexedDB fallback
   - Robust validation, currency formatting, date formatting
   - Event delegation, batched DOM updates (rAF/DocumentFragment)
   - Drive backup/restore (GIS + Drive v3) with safer UI
   - Image compression with OffscreenCanvas / createImageBitmap fallback
   - Unified behaviors across pages; mobile/ARIA polish
*/

/* =========================================
   GLOBAL NAMESPACE
========================================= */
const TWX = (() => {
    "use strict";

    /* -------- constants & keys -------- */
    const KEYS = {
        BOUGHT: "twicks_bought_v1",
        FORSALE: "twicks_forsale_v1",
        SOLD: "twicks_sold_v1",
        GREET: "twicks_greet_pref",
        SELLERS: "twicks_sellers_v1",
        CASH: "twicks_cash_v1",
        PREF_PAID_BOTTOM: "twicks_paid_bottom_pref",
        SHIP_OUT_MAP: "twicks_shipping_v1", // { buyerName: number }
        SELLER_LAST: "twicks_last_seller",
        BUYERS: "twicks_buyers_v1",
        BUYER_LAST: "twicks_last_buyer",
    };

    const DB = { NAME: "twicksDB", STORE: "store" };

    const GOOGLE = {
        CLIENT_ID:
            "23582425609-ndhvh130da587955g1cvm51v3nt4qeu8.apps.googleusercontent.com",
        SCOPES: "https://www.googleapis.com/auth/drive.file",
    };

    /* -------- Intl formatters -------- */
    const peso = new Intl.NumberFormat("en-PH", {
        style: "currency",
        currency: "PHP",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
    const dateFmt = new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
    });

    /* =========================================
       UTIL
    ========================================= */
    const Util = {
        uid: () =>
            Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        fmtMoney: (n) => peso.format(Number(n || 0)),
        fmtSigned: (n) =>
            (n < 0 ? "-" : "") + peso.format(Math.abs(Number(n || 0))),
        esc: (s) =>
            String(s).replace(/[&<>"']/g, (c) =>
                ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
                c
                ]
            ),
        clampNumber: (v) => {
            const n = Number(v);
            return Number.isFinite(n) ? n : 0;
        },
        nowGreetingKey: () => {
            const h = new Date().getHours();
            return h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
        },
        greetingWord: () => {
            const sel = document.getElementById("greetSelect");
            const pref =
                (sel && sel.value) ||
                localStorage.getItem(KEYS.GREET) ||
                Util.nowGreetingKey();
            return "Good " + (pref[0].toUpperCase() + pref.slice(1));
        },
        ariaLiveAnnounce(msg) {
            let n = document.getElementById("twx-aria-live");
            if (!n) {
                n = document.createElement("div");
                n.id = "twx-aria-live";
                n.setAttribute("aria-live", "polite");
                n.style.position = "fixed";
                n.style.left = "-9999px";
                n.style.top = "auto";
                n.style.width = "1px";
                n.style.height = "1px";
                document.body.appendChild(n);
            }
            n.textContent = msg;
        },
        rafBatch(fn) {
            // Prevent layout thrash by scheduling on next frame
            requestAnimationFrame(fn);
        },
        deriveNameFromFile(f) {
            if (!f?.name) return "Card";
            const base = f.name.replace(/\.[^.]+$/, "");
            return base || "Card";
        },
    };

    /* =========================================
       STORAGE (localStorage + IndexedDB fallback)
    ========================================= */
    const Storage = (() => {
        let idb = null;

        function openDB() {
            return new Promise((resolve, reject) => {
                const req = indexedDB.open(DB.NAME, 1);
                req.onupgradeneeded = () => req.result.createObjectStore(DB.STORE);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        }
        async function ensureDB() {
            if (idb) return idb;
            try {
                idb = await openDB();
            } catch {
                idb = null;
            }
            return idb;
        }
        async function idbGet(key) {
            const db = await ensureDB();
            if (!db) return undefined;
            return await new Promise((resolve) => {
                const tx = db.transaction(DB.STORE, "readonly");
                const st = tx.objectStore(DB.STORE);
                const r = st.get(key);
                r.onsuccess = () => resolve(r.result);
                r.onerror = () => resolve(undefined);
            });
        }
        async function idbSet(key, val) {
            const db = await ensureDB();
            if (!db) return;
            await new Promise((resolve, reject) => {
                const tx = db.transaction(DB.STORE, "readwrite");
                const st = tx.objectStore(DB.STORE);
                st.put(val, key);
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
            });
        }

        return {
            async load(key, fallback = []) {
                try {
                    const raw = localStorage.getItem(key);
                    if (raw != null) {
                        try {
                            const parsed = JSON.parse(raw);
                            return parsed ?? fallback;
                        } catch {
                            return fallback;
                        }
                    }
                } catch { }
                const v = await idbGet(key);
                return v ?? fallback;
            },
            async save(key, val) {
                try {
                    localStorage.setItem(key, JSON.stringify(val ?? []));
                    return;
                } catch { }
                await idbSet(key, val ?? []);
            },
            localGet(key) {
                try {
                    const raw = localStorage.getItem(key);
                    return raw == null ? null : raw;
                } catch {
                    return null;
                }
            },
            localSet(key, val) {
                try {
                    localStorage.setItem(key, val);
                } catch { }
            },
            localDel(key) {
                try {
                    localStorage.removeItem(key);
                } catch { }
            },
        };
    })();

    /* =========================================
       IMAGE HELPERS (compression)
    ========================================= */
    /* =========================================
       IMAGE HELPERS (compression)
    ========================================= */

    const Img = {
        fileToDataURL(file) {
            return new Promise((res, rej) => {
                const r = new FileReader();
                r.onload = () => res(r.result);
                r.onerror = rej;
                r.readAsDataURL(file);
            });
        },

        async compress(file, maxDim = 1000, quality = 0.7) {
            try {
                const bmp = await createImageBitmap(file);
                const scale = Math.min(maxDim / Math.max(bmp.width, bmp.height), 1);
                const nw = Math.round(bmp.width * scale);
                const nh = Math.round(bmp.height * scale);

                let canvas, ctx;
                if ("OffscreenCanvas" in window) {
                    canvas = new OffscreenCanvas(nw, nh);
                    ctx = canvas.getContext("2d", { alpha: false });
                    ctx.drawImage(bmp, 0, 0, nw, nh);

                    let blob =
                        (await canvas.convertToBlob({
                            type: "image/webp",
                            quality,
                        }).catch(() => null)) ||
                        (await canvas.convertToBlob({
                            type: "image/jpeg",
                            quality,
                        }).catch(() => null));

                    if (!blob) throw new Error("Blob conversion failed");
                    return await Img.blobToDataURL(blob);

                } else {
                    const c = document.createElement("canvas");
                    c.width = nw;
                    c.height = nh;
                    const c2d = c.getContext("2d", { alpha: false });
                    c2d.drawImage(bmp, 0, 0, nw, nh);

                    let out =
                        c.toDataURL("image/webp", quality) ||
                        c.toDataURL("image/jpeg", quality);

                    return out;
                }

            } catch {
                // fallback: load normally then resize
                const dataUrl = await Img.fileToDataURL(file);

                const img = await new Promise((res, rej) => {
                    const i = new Image();
                    i.onload = () => res(i);
                    i.onerror = rej;
                    i.src = dataUrl;
                });

                const scale = Math.min(maxDim / Math.max(img.naturalWidth, img.naturalHeight), 1);
                const nw = Math.round(img.naturalWidth * scale);
                const nh = Math.round(img.naturalHeight * scale);

                const c = document.createElement("canvas");
                c.width = nw;
                c.height = nh;
                c.getContext("2d", { alpha: false }).drawImage(img, 0, 0, nw, nh);

                let out =
                    c.toDataURL("image/webp", quality) ||
                    c.toDataURL("image/jpeg", quality);

                if (!out || !out.startsWith("data:image/")) out = dataUrl;
                return out;
            }
        },

        blobToDataURL(blob) {
            return new Promise((resolve, reject) => {
                const r = new FileReader();
                r.onload = () => resolve(r.result);
                r.onerror = reject;
                r.readAsDataURL(blob);
            });
        },
    };
    /* =========================================
       SUPABASE STORAGE (images in bucket "cards")
    ========================================= */

    const SUPABASE_URL = "https://zqbkuwrwgvfhkajsebfo.supabase.co";
    const SUPABASE_ANON_KEY = "YeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...";
    const SUPABASE_BUCKET = "cards";

    const SupaStore = (() => {
        let client = null;

        function getClient() {
            if (!window.supabase) {
                console.warn("[Twicks] supabase-js not loaded; using local dataURL fallback.");
                return null;
            }
            if (!client) {
                const { createClient } = window.supabase;
                client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            }
            return client;
        }

        async function uploadCardImage(file) {
            const supa = getClient();

            // Fallback to local storage if Supabase not loaded
            if (!supa) return await Img.compress(file, 1000, 0.7);

            // 1) Compress image
            const dataUrl = await Img.compress(file, 1200, 0.8);
            const blob = await (await fetch(dataUrl)).blob();

            const ext = blob.type === "image/webp" ? "webp" : "jpg";
            const path = `cards/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

            const { error } = await supa.storage
                .from(SUPABASE_BUCKET)
                .upload(path, blob, {
                    cacheControl: "3600",
                    upsert: false,
                    contentType: blob.type,
                });

            if (error) {
                console.warn("[Twicks] Supabase upload failed; using local fallback", error);
                return dataUrl;
            }

            const { data } = supa.storage.from(SUPABASE_BUCKET).getPublicUrl(path);
            return data?.publicUrl || dataUrl;
        }

        return { uploadCardImage };
    })();


    /* =========================================
       GOOGLE DRIVE (GIS + Drive v3)
    ========================================= */
    const Drive = (() => {
        let accessToken = null;
        let tokenClient = null;

        function setButtonsState(signedIn) {
            const dis = (el, disabled) => {
                if (!el) return;
                el.style.opacity = disabled ? ".6" : "1";
                el.style.pointerEvents = disabled ? "none" : "auto";
                el.setAttribute("aria-disabled", disabled ? "true" : "false");
            };
            dis(document.getElementById("btnBackupDrive"), !signedIn);
            dis(document.getElementById("btnRestoreDrive"), !signedIn);
            dis(document.getElementById("btnSignoutDrive"), !signedIn);
        }

        function installButtons() {
            const headerBrand = document.querySelector(".topbar .branding");
            if (!headerBrand || document.getElementById("twxDriveWrap")) return;

            const wrap = document.createElement("div");
            wrap.id = "twxDriveWrap";
            wrap.style.display = "flex";
            wrap.style.gap = "8px";
            wrap.style.marginLeft = "12px";
            wrap.setAttribute("role", "group");
            wrap.setAttribute("aria-label", "Google Drive controls");

            const btn = (id, label, cls) => {
                const b = document.createElement("button");
                b.id = id;
                b.textContent = label;
                b.className = cls;
                b.type = "button";
                return b;
            };

            const signIn = btn("btnSignInDrive", "🔐 Sign in", "btn secondary");
            signIn.onclick = () =>
                ensureSignedIn(true).catch((e) => alert(e?.message || e));

            const backup = btn("btnBackupDrive", "☁️ Backup", "btn secondary");
            backup.onclick = () => backupToDrive().catch((e) => alert(e?.message || e));

            const restore = btn("btnRestoreDrive", "☁️ Restore", "btn secondary");
            restore.onclick = () => restoreFromDrive().catch((e) => alert(e?.message || e));

            const signOut = btn("btnSignoutDrive", "🚪 Sign out", "btn secondary");
            signOut.onclick = () => {
                if (!accessToken) return;
                try {
                    google.accounts.oauth2.revoke(accessToken);
                } catch { }
                accessToken = null;
                setButtonsState(false);
                alert("Signed out of Google.");
            };

            wrap.appendChild(signIn);
            wrap.appendChild(backup);
            wrap.appendChild(restore);
            wrap.appendChild(signOut);
            headerBrand.appendChild(wrap);
            setButtonsState(!!accessToken);
        }

        function bootGIS() {
            if (window.google?.accounts?.oauth2) {
                tokenClient = google.accounts.oauth2.initTokenClient({
                    client_id: GOOGLE.CLIENT_ID,
                    scope: GOOGLE.SCOPES,
                    prompt: "",
                    callback: (resp) => {
                        if (resp?.access_token) {
                            accessToken = resp.access_token;
                            setButtonsState(true);
                        } else {
                            alert("Google sign-in failed.");
                        }
                    },
                });
            }
        }

        function ensureSignedIn(forcePrompt = false) {
            return new Promise((resolve, reject) => {
                if (accessToken && !forcePrompt) return resolve(accessToken);
                if (!tokenClient)
                    return reject(
                        new Error("Google Identity client not ready. Reload the page.")
                    );
                tokenClient.requestAccessToken({ prompt: forcePrompt ? "consent" : "" });
                const t0 = Date.now();
                (function wait() {
                    if (accessToken) return resolve(accessToken);
                    if (Date.now() - t0 > 8000)
                        return reject(new Error("Timed out requesting Google token."));
                    setTimeout(wait, 100);
                })();
            });
        }

        async function uploadJson(filename, jsonObj) {
            const token = await ensureSignedIn();
            const metadata = { name: filename, mimeType: "application/json" };
            const body = JSON.stringify(jsonObj);
            const boundary = "-------twicksdrive" + Math.random().toString(36).slice(2);
            const delimiter = `\r\n--${boundary}\r\n`;
            const close = `\r\n--${boundary}--`;

            const multipartBody =
                delimiter +
                "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
                JSON.stringify(metadata) +
                delimiter +
                "Content-Type: application/json\r\n\r\n" +
                body +
                close;

            const res = await fetch(
                "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": `multipart/related; boundary=${boundary}`,
                    },
                    body: multipartBody,
                }
            );
            if (!res.ok) throw new Error("Drive upload failed: " + (await res.text()));
            return res.json();
        }

        async function listBackups() {
            const token = await ensureSignedIn();
            const q = [
                "mimeType='application/json'",
                "trashed=false",
                "name contains 'twicks_backup_'",
            ].join(" and ");
            const url = new URL("https://www.googleapis.com/drive/v3/files");
            url.searchParams.set("q", q);
            url.searchParams.set("orderBy", "modifiedTime desc");
            url.searchParams.set("pageSize", "20");
            url.searchParams.set("fields", "files(id,name,modifiedTime,size)");
            const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
            if (!res.ok) throw new Error("Drive list failed: " + (await res.text()));
            const data = await res.json();
            return data.files || [];
        }

        async function downloadJson(fileId) {
            const token = await ensureSignedIn();
            const res = await fetch(
                `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
                { headers: { Authorization: `Bearer ${token}` } }
            );
            if (!res.ok) throw new Error("Drive download failed: " + (await res.text()));
            return res.json();
        }

        async function backupToDrive() {
            const payload = {
                bought: await Storage.load(KEYS.BOUGHT),
                forsale: await Storage.load(KEYS.FORSALE),
                sold: await Storage.load(KEYS.SOLD),
                cash: await Storage.load(KEYS.CASH),
                sellers: await Storage.load(KEYS.SELLERS),
                shipping: await Storage.load(KEYS.SHIP_OUT_MAP),
                buyers: await Storage.load(KEYS.BUYERS),
                exportedAt: new Date().toISOString(),
                version: 3,
            };
            const name = `twicks_backup_${new Date()
                .toISOString()
                .replace(/[:.]/g, "-")}.json`;
            await uploadJson(name, payload);
            alert("✅ Backup uploaded to Google Drive.");
        }

        async function restoreFromDrive() {
            const files = await listBackups();
            if (!files.length) {
                alert("No backups found in Drive.");
                return;
            }
            const top = files[0];
            const choose = confirm(
                `Restore latest backup?\n\n${top.name}\nModified: ${dateFmt.format(
                    new Date(top.modifiedTime)
                )}\nSize: ${(Number(top.size || 0) / 1024).toFixed(1)} KB`
            );
            const chosen = choose
                ? top
                : (() => {
                    const names = files
                        .map(
                            (f, i) =>
                                `${i + 1}. ${f.name} (${dateFmt.format(
                                    new Date(f.modifiedTime)
                                )})`
                        )
                        .join("\n");
                    const idx = Number(prompt(`Choose a file number:\n\n${names}`)) - 1;
                    if (isNaN(idx) || !files[idx]) return null;
                    return files[idx];
                })();
            if (!chosen) return;

            const data = await downloadJson(chosen.id);
            if (!confirm("Import this Drive backup and overwrite local data?")) return;

            if (data.bought) await Storage.save(KEYS.BOUGHT, data.bought);
            if (data.forsale) await Storage.save(KEYS.FORSALE, data.forsale);
            if (data.sold) await Storage.save(KEYS.SOLD, data.sold);
            if (data.cash) await Storage.save(KEYS.CASH, data.cash);
            if (data.sellers) await Storage.save(KEYS.SELLERS, data.sellers);
            if (data.shipping) await Storage.save(KEYS.SHIP_OUT_MAP, data.shipping);
            if (data.buyers) await Storage.save(KEYS.BUYERS, data.buyers);

            alert("✅ Restore complete. Reloading…");
            location.reload();
        }

        function isSignedIn() {
            return !!accessToken;
        }

        window.addEventListener("load", () => {
            installButtons();
            bootGIS();
        });

        return { backupToDrive, restoreFromDrive, ensureSignedIn, installButtons, isSignedIn };
    })();

    /* ============================
     AUTO BACKUP (Google Drive)
     ============================ */

    // One rolling file in Drive:
    const AUTO_BACKUP_FILENAME = "twicks_autobackup.json";
    const AUTO_INTERVAL_MS = 5 * 60 * 1000;       // 5 minutes
    const AUTO_IDLE_DEBOUNCE_MS = 30 * 1000;      // 30 seconds of no changes
    const AUTO_VISIBILITY_FLUSH = true;           // backup when tab hides

    const AutoBackup = (() => {
        let dirty = false;
        let lastSerialized = "";
        let running = false;
        let intervalId = null;
        let idleTimer = null;

        async function buildPayload() {
            return {
                bought: await Storage.load(KEYS.BOUGHT),
                forsale: await Storage.load(KEYS.FORSALE),
                sold: await Storage.load(KEYS.SOLD),
                cash: await Storage.load(KEYS.CASH),
                sellers: await Storage.load(KEYS.SELLERS),
                shipping: await Storage.load(KEYS.SHIP_OUT_MAP),
                buyers: await Storage.load(KEYS.BUYERS),
                exportedAt: new Date().toISOString(),
                version: 3,
                auto: true,
            };
        }

        function sameSnapshot(a, b) {
            return a === b;
        }

        // Create or update a single JSON file in Drive
        async function driveUpsertJsonRolling(filename, jsonObj) {
            // If not signed in, just skip silently
            if (!Drive.isSignedIn || !Drive.isSignedIn()) return;

            const token = await Drive.ensureSignedIn(false);
            const metadata = { name: filename, mimeType: "application/json" };
            const body = JSON.stringify(jsonObj);
            const boundary = "----twicks-auto-" + Math.random().toString(36).slice(2);
            const delimiter = `\r\n--${boundary}\r\n`;
            const closeDelim = `\r\n--${boundary}--`;

            const multipartBody =
                delimiter + "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
                JSON.stringify(metadata) +
                delimiter + "Content-Type: application/json\r\n\r\n" +
                body + closeDelim;

            // Look for an existing file with this exact name
            const searchUrl = new URL("https://www.googleapis.com/drive/v3/files");
            searchUrl.searchParams.set(
                "q",
                `name='${filename.replace(/'/g, "\\'")}' and trashed=false`
            );
            searchUrl.searchParams.set("pageSize", "1");
            searchUrl.searchParams.set("fields", "files(id,name)");

            const searchRes = await fetch(searchUrl, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!searchRes.ok) {
                throw new Error("Drive search failed: " + (await searchRes.text()));
            }
            const searchData = await searchRes.json();
            const existing = searchData.files && searchData.files[0];

            const endpoint = existing
                ? `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=multipart`
                : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";

            const res = await fetch(endpoint, {
                method: existing ? "PATCH" : "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": `multipart/related; boundary=${boundary}`,
                },
                body: multipartBody,
            });

            if (!res.ok) {
                throw new Error("Drive upsert failed: " + (await res.text()));
            }
            return res.json();
        }

        async function performBackup(reason = "interval") {
            if (running) return;
            running = true;

            try {
                if (!dirty) return;

                const payload = await buildPayload();
                const serialized = JSON.stringify(payload);

                if (!dirty && sameSnapshot(serialized, lastSerialized)) return;

                await driveUpsertJsonRolling(AUTO_BACKUP_FILENAME, payload);
                lastSerialized = serialized;
                dirty = false;
                console.log(`[Twicks AutoBackup] ✅ Saved (${reason})`);
            } catch (err) {
                console.warn(
                    "[Twicks AutoBackup] Skipped:",
                    err?.message || err
                );
            } finally {
                running = false;
            }
        }

        function scheduleIdle() {
            if (idleTimer) clearTimeout(idleTimer);
            idleTimer = setTimeout(() => {
                if (dirty) performBackup("idle");
            }, AUTO_IDLE_DEBOUNCE_MS);
        }

        function start() {
            if (intervalId) return;
            intervalId = setInterval(() => {
                if (dirty) performBackup("interval");
            }, AUTO_INTERVAL_MS);

            window.addEventListener("online", () => {
                if (dirty) performBackup("online");
            });

            if (AUTO_VISIBILITY_FLUSH) {
                document.addEventListener("visibilitychange", () => {
                    if (document.visibilityState === "hidden" && dirty) {
                        performBackup("visibility");
                    }
                });
            }
        }

        return {
            markDirty() {
                dirty = true;
                scheduleIdle();
            },
            start,
            forceNow() {
                return performBackup("manual");
            },
        };
    })();

    // Start auto-backup loop when page is ready
    document.addEventListener("DOMContentLoaded", () => {
        AutoBackup.start();
    });
    // ============================
    // SHIPPING MESSAGE GENERATOR
    // ============================

    (function initShippingMsg() {
        // Only run on the page that actually has the modal
        const modal = document.getElementById("shipMsgModal");
        const closeBtn = document.getElementById("closeShipMsg");
        const bg = document.getElementById("shipMsgBg");
        const copyBtn = document.getElementById("copyShipMsg");
        const buyerLabel = document.getElementById("shipMsgBuyer");
        const tnInput = document.getElementById("shipTrackingInput");

        // If any of these are missing, we’re not on sold.html → bail out safely
        if (!modal || !closeBtn || !bg || !copyBtn || !buyerLabel || !tnInput) return;

        // Open modal when clicking any "Shipping Msg" button
        document.addEventListener("click", (e) => {
            const btn = e.target.closest(".ship-msg-btn");
            if (!btn) return;

            const buyer = btn.dataset.buyer || "";
            buyerLabel.textContent = "Buyer: " + buyer;
            tnInput.value = "";
            modal.classList.add("show");
        });

        // Close modal
        const hide = () => modal.classList.remove("show");
        closeBtn.addEventListener("click", hide);
        bg.addEventListener("click", hide);

        // Copy message
        copyBtn.addEventListener("click", async () => {
            const tn = tnInput.value.trim();

            const hour = new Date().getHours();
            const greet =
                hour < 12 ? "Good morning" :
                    hour < 18 ? "Good afternoon" :
                        "Good evening";

            const msg = `${greet} brother! Napaship ko na po.\n\nTN mo brother: ${tn}\n\nSalamat brother! God bless!`;


            await navigator.clipboard.writeText(msg);

            copyBtn.textContent = "Copied!";
            setTimeout(() => {
                copyBtn.textContent = "Copy Message";
            }, 1600);
        });
    })();


    // Hook into Storage.save so any change to data marks it as dirty
    (function patchStorageSaveForAutoBackup() {
        if (!Storage || typeof Storage.save !== "function") return;
        const originalSave = Storage.save;
        Storage.save = async function patchedSave(key, val) {
            await originalSave.call(Storage, key, val);
            AutoBackup.markDirty();
        };
        console.log("[Twicks AutoBackup] Storage.save() hook installed");
    })();

    // Hook into Storage.save so any change to data marks it as dirty
    (function patchStorageSaveForAutoBackup() {
        if (!Storage || typeof Storage.save !== "function") return;
        const originalSave = Storage.save;
        Storage.save = async function patchedSave(key, val) {
            await originalSave.call(Storage, key, val);
            AutoBackup.markDirty();
        };
        console.log("[Twicks AutoBackup] Storage.save() hook installed");
    })();


    /* =========================================
       CLOUD BACKUP (Neon + Netlify)
    ========================================= */

    const CLOUD_BACKUP_URL =
        "https://twicks-storage-5okl.vercel.app/api/twicks-backup";


    async function backupToCloud() {
        try {
            const payload = {
                localStorage: { ...localStorage }
            };

            const res = await fetch(CLOUD_BACKUP_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    payload,
                    label: "manual"
                })
            });

            const json = await res.json();
            if (json.success) {
                alert("☁️ Cloud backup saved!");
            } else {
                alert("Cloud backup failed: " + JSON.stringify(json));
            }
        } catch (err) {
            alert("⚠ Cloud backup error: " + err.message);
        }
    }

    // Fetch the newest backup from Neon and restore localStorage
    async function restoreFromCloud() {
        try {
            const res = await fetch(CLOUD_BACKUP_URL);
            const json = await res.json();

            if (!json.success || !json.backup) {
                alert("❌ No cloud backup found.");
                return;
            }

            const data = json.backup.payload;

            if (data.localStorage && typeof data.localStorage === "object") {
                Object.keys(data.localStorage).forEach((key) => {
                    localStorage.setItem(key, data.localStorage[key]);
                });

                alert("☁️ Cloud backup restored! Reloading…");
                location.reload();
            } else {
                alert("Cloud backup format invalid.");
            }
        } catch (err) {
            alert("⚠ Cloud restore error: " + err.message);
        }
    }

    /* =========================================
       UI helpers shared across pages
    ========================================= */

    /* =========================================
       UI helpers shared across pages
    ========================================= */
    const UI = (() => {
        let imageModal,
            modalBg,
            modalImg,
            modalCaption,
            closeImageModalBtn,
            activePage;

        function initModal() {
            imageModal = document.getElementById("imageModal");
            modalBg =
                document.getElementById("imageModalBg") ||
                document.getElementById("imageModalBgFS") ||
                document.getElementById("imageModalBgSold") ||
                document.getElementById("imageModalBgCash");
            modalImg = document.getElementById("modalImage");
            modalCaption = document.getElementById("modalCaption");
            closeImageModalBtn = document.getElementById("closeImageModal");

            closeImageModalBtn && (closeImageModalBtn.onclick = close);
            modalBg && (modalBg.onclick = close);
            document.addEventListener("keydown", (e) => {
                if (e.key === "Escape") close();
            });
        }

        function markActiveNav() {
            const path = location.pathname.split("/").pop();
            const map = {
                "index.html": "inventory",
                "forsale.html": "forsale",
                "sold.html": "sold",
                "cash.html": "cash",
            };
            const current = map[path] || "";
            document
                .querySelectorAll(".site-link")
                .forEach((a) =>
                    a.classList.toggle("active", a.dataset.page === current)
                );
            if (current) document.body.setAttribute("data-page", current);
            activePage = current;
        }

        function open(src, caption = "") {
            if (!imageModal) return;
            modalImg.src = src;
            modalCaption.textContent = caption;
            imageModal.classList.add("show");
            imageModal.setAttribute("aria-hidden", "false");
        }
        function close() {
            if (!imageModal) return;
            imageModal.classList.remove("show");
            imageModal.setAttribute("aria-hidden", "true");
            modalImg.src = "";
            modalCaption.textContent = "";
        }

        return {
            initModal,
            markActiveNav,
            openImageModal: open,
            closeImageModal: close,
            get activePage() {
                return activePage;
            },
        };
    })();

    /* =========================================
       INVENTORY PAGE (index.html)
    ========================================= */
    const Inventory = (() => {
        let container;

        async function getSellers() {
            const set = new Set(await Storage.load(KEYS.SELLERS));
            (await Storage.load(KEYS.BOUGHT)).forEach((it) => {
                if (it.seller) set.add(it.seller);
            });
            return Array.from(set).sort((a, b) => a.localeCompare(b));
        }
        async function addSeller(name) {
            const set = new Set(await Storage.load(KEYS.SELLERS));
            if (name) set.add(name);
            await Storage.save(KEYS.SELLERS, Array.from(set));
        }

        async function populateSellerSelect(selectEl) {
            if (!selectEl) return;
            const sellers = await getSellers();
            const last = Storage.localGet(KEYS.SELLER_LAST) || "";
            selectEl.innerHTML = `
        <option value="">— Select Seller —</option>
        ${sellers.map((s) => `<option value="${Util.esc(s)}">${Util.esc(s)}</option>`).join("")}
        <option value="__new__">➕ Add new seller…</option>
      `;
            if (last && sellers.includes(last)) selectEl.value = last;
        }

        async function chooseSellerFlow(selectEl) {
            if (!selectEl) return null;
            if (selectEl.value === "__new__") {
                const name = prompt("New seller name:")?.trim();
                if (!name) {
                    selectEl.value = "";
                    return null;
                }
                await addSeller(name);
                await populateSellerSelect(selectEl);
                selectEl.value = name;
                Storage.localSet(KEYS.SELLER_LAST, name);
                return name;
            }
            if (!selectEl.value) return null;
            Storage.localSet(KEYS.SELLER_LAST, selectEl.value);
            return selectEl.value;
        }

        function injectShipInField() {
            if (document.getElementById("b_ship")) return;
            const buyEl = document.getElementById("b_buy");
            if (!buyEl) return;
            const ship = document.createElement("input");
            ship.id = "b_ship";
            ship.type = "number";
            ship.step = "0.01";
            ship.placeholder = "Ship-in ₱";
            ship.style.minWidth = "140px";
            buyEl.parentElement.insertBefore(ship, buyEl.nextSibling);
        }

        async function renderBought() {
            const sumCardsEl = document.getElementById("sumCards");
            const sumSpentEl = document.getElementById("sumSpent");
            const sumWorthEl = document.getElementById("sumWorth");
            const sumProfitEl = document.getElementById("sumProfit");
            const summarySellersEl = document.getElementById("summarySellers");

            const items = await Storage.load(KEYS.BOUGHT);
            const grouped = {};
            items.forEach((it) => {
                const s = it.seller || "(No seller)";
                (grouped[s] ||= []).push(it);
            });

            let totalCount = 0,
                totalSpent = 0,
                totalWorth = 0;
            const frag = document.createDocumentFragment();
            Object.keys(grouped).forEach((seller) => {
                const list = grouped[seller];
                const sellerEl = document.createElement("div");
                sellerEl.className = "seller panel";
                const spent = list.reduce(
                    (a, b) => a + Number(b.buy || 0) + Number(b.ship || 0),
                    0
                );
                const worth = list.reduce((a, b) => a + Number(b.sell || 0), 0);
                const profit = worth - spent;

                sellerEl.innerHTML = `
          <div class="seller-header">
            <div>
              <h2>${Util.esc(seller)}</h2>
              <div class="seller-meta">
                <div>Cards: ${list.length}</div>
                <div>• Spent: ${Util.fmtMoney(spent)}</div>
                <div>• Worth: ${Util.fmtMoney(worth)}</div>
                <div>• Profit: <span class="seller-profit">${Util.fmtMoney(profit)}</span></div>
              </div>
            </div>
            <div>
              <button class="btn secondary seller-list" data-seller="${encodeURIComponent(
                    seller
                )}">List Seller</button>
            </div>
          </div>
        `;

                const grid = document.createElement("div");
                grid.className = "card-grid";

                list.forEach((card) => {
                    totalCount++;
                    const buyPlusShip = Number(card.buy || 0) + Number(card.ship || 0);
                    totalSpent += buyPlusShip;
                    totalWorth += Number(card.sell || 0);
                    const profitEach = Number(card.sell || 0) - buyPlusShip;
                    const profitClass = profitEach >= 0 ? "paid" : "pending";

                    const div = document.createElement("div");
                    div.className = "card";
                    div.dataset.id = card.id;
                    div.innerHTML = `
            <div class="img-wrap"><img src="${card.image}" alt="${Util.esc(
                        card.name || "Card"
                    )}" /></div>
            <div class="info">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <div>
                  <div class="title">${Util.esc(card.name || "Card")}</div>
                  <div class="meta">Buy: ${Util.fmtMoney(
                        card.buy
                    )} • Ship-in: ${Util.fmtMoney(
                        card.ship || 0
                    )} • Sell: ${Util.fmtMoney(card.sell)}</div>
                </div>
                <div class="card-actions">
                  <button class="small-btn copy-img" title="Copy/Open image">📋</button>
                  <button class="small-btn list-for-sale" data-id="${card.id
                        }">List for Sale</button>
                  <button class="small-btn delete-item" data-id="${card.id
                        }" title="Delete">🗑️</button>
                </div>
              </div>
              <div class="status-pill ${profitClass}" style="display:inline-block;margin-top:8px;">
                ${(profitEach > 0 ? "+" : "") + Util.fmtMoney(profitEach)}
              </div>
            </div>
          `;
                    grid.appendChild(div);
                });

                sellerEl.appendChild(grid);
                frag.appendChild(sellerEl);
            });

            Util.rafBatch(() => {
                container.innerHTML = "";
                container.appendChild(frag);

                if (sumCardsEl) sumCardsEl.textContent = totalCount;
                if (sumSpentEl) sumSpentEl.textContent = Util.fmtMoney(totalSpent);
                if (sumWorthEl) sumWorthEl.textContent = Util.fmtMoney(totalWorth);
                const totalProfit = totalWorth - totalSpent;
                if (sumProfitEl) {
                    sumProfitEl.textContent =
                        (totalProfit >= 0 ? "+" : "") + Util.fmtMoney(totalProfit);
                    sumProfitEl.style.color =
                        totalProfit >= 0 ? "var(--good)" : "var(--bad)";
                }

                if (summarySellersEl) {
                    summarySellersEl.innerHTML = "";
                    Object.keys(grouped).forEach((s) => {
                        const list = grouped[s];
                        const spent = list.reduce(
                            (a, b) => a + Number(b.buy || 0) + Number(b.ship || 0),
                            0
                        );
                        const div = document.createElement("div");
                        div.className = "seller-mini";
                        div.innerHTML = `<div>${Util.esc(s)} (${list.length
                            })</div><div style="font-weight:700;color:${spent >= 0 ? "var(--good)" : "var(--bad)"
                            }">${Util.fmtMoney(spent)}</div>`;
                        summarySellersEl.appendChild(div);
                    });
                }
            });
        }

        function bindEvents() {
            // image click via delegation
            container.addEventListener("click", (e) => {
                const img = e.target.closest(".img-wrap img");
                if (img) {
                    UI.openImageModal(img.src, img.alt);
                    return;
                }

                const copyBtn = e.target.closest(".copy-img");
                if (copyBtn) {
                    e.preventDefault();
                    const card = copyBtn.closest(".card");
                    const src = card?.querySelector("img")?.src;
                    if (!src) return;
                    (async () => {
                        try {
                            const blob = await (await fetch(src)).blob();
                            await navigator.clipboard.write([
                                new ClipboardItem({ [blob.type]: blob }),
                            ]);
                            alert("Image copied.");
                        } catch {
                            window.open(src, "_blank");
                        }
                    })();
                    return;
                }

                const listBtn = e.target.closest(".list-for-sale");
                if (listBtn) {
                    e.preventDefault();
                    (async () => {
                        const id = listBtn.dataset.id;
                        const items = await Storage.load(KEYS.BOUGHT);
                        const idx = items.findIndex((x) => x.id === id);
                        if (idx === -1) {
                            alert("Item not found");
                            return;
                        }
                        const item = items.splice(idx, 1)[0];
                        await Storage.save(KEYS.BOUGHT, items);

                        const listings = await Storage.load(KEYS.FORSALE);
                        const priceDefault =
                            item.sell != null
                                ? Number(item.sell)
                                : Number(item.buy || 0) + Number(item.ship || 0);
                        listings.unshift({
                            id: Util.uid(),
                            name: item.name || "Card",
                            price: priceDefault,
                            buy: Number(item.buy || 0) + Number(item.ship || 0), // carry buy+ship
                            ship_in: Number(item.ship || 0),
                            seller: item.seller || "",
                            image: item.image,
                            createdAt: Date.now(),
                        });
                        await Storage.save(KEYS.FORSALE, listings);
                        await renderBought();
                        Util.ariaLiveAnnounce("Moved item to For Sale");
                        alert("Moved to For Sale.");
                    })();
                    return;
                }

                const delBtn = e.target.closest(".delete-item");
                if (delBtn) {
                    e.preventDefault();
                    (async () => {
                        const id = delBtn.dataset.id;
                        if (!confirm("Delete this item from Inventory?")) return;
                        const items = await Storage.load(KEYS.BOUGHT);
                        const idx = items.findIndex((x) => x.id === id);
                        if (idx === -1) {
                            alert("Item not found");
                            return;
                        }
                        items.splice(idx, 1);
                        await Storage.save(KEYS.BOUGHT, items);
                        await renderBought();
                    })();
                    return;
                }

                const bulkBtn = e.target.closest(".seller-list");
                if (bulkBtn) {
                    e.preventDefault();
                    (async () => {
                        const seller = decodeURIComponent(bulkBtn.dataset.seller);
                        if (!confirm(`List ALL cards from ${seller} for sale?`)) return;
                        const items = await Storage.load(KEYS.BOUGHT);
                        const toMove = items.filter((i) => (i.seller || "(No seller)") === seller);
                        const remain = items.filter((i) => (i.seller || "(No seller)") !== seller);
                        const listings = await Storage.load(KEYS.FORSALE);
                        toMove.forEach((it) =>
                            listings.unshift({
                                id: Util.uid(),
                                name: it.name || "Card",
                                price:
                                    it.sell != null
                                        ? Number(it.sell)
                                        : Number(it.buy || 0) + Number(it.ship || 0),
                                buy: Number(it.buy || 0) + Number(it.ship || 0),
                                ship_in: Number(it.ship || 0),
                                seller: it.seller || "",
                                image: it.image,
                                createdAt: Date.now(),
                            })
                        );
                        await Storage.save(KEYS.BOUGHT, remain);
                        await Storage.save(KEYS.FORSALE, listings);
                        await renderBought();
                        alert(`Moved ${toMove.length} items to For Sale.`);
                    })();
                }
            });

            // seller dropdown & add
            const sellerSelect = document.getElementById("b_seller_select");
            sellerSelect?.addEventListener("change", () => {
                (async () => {
                    if (sellerSelect.value === "__new__")
                        await chooseSellerFlow(sellerSelect);
                    else Storage.localSet(KEYS.SELLER_LAST, sellerSelect.value || "");
                })();
            });

            // Manage Sellers
            const ensureManageBtn = (() => {
                let done = false;
                return () => {
                    if (done) return;
                    if (!sellerSelect) return;
                    const btn = document.createElement("button");
                    btn.id = "manageSellersBtn";
                    btn.textContent = "⚙ Manage sellers";
                    btn.className = "btn secondary";
                    btn.style.marginLeft = "8px";
                    sellerSelect.parentElement.insertBefore(btn, sellerSelect.nextSibling);
                    btn.addEventListener("click", showManageSellersModal);
                    done = true;
                };
            })();
            ensureManageBtn();

            // add bought item
            const addBtn = document.getElementById("addBoughtBtn");
            addBtn?.addEventListener("click", async () => {
                // choose seller (sticky)
                const sel = document.getElementById("b_seller_select");
                let chosenSeller = await (async () => {
                    if (!sel) return null;
                    if (sel.value === "__new__") return await chooseSellerFlow(sel);
                    return sel.value || Storage.localGet(KEYS.SELLER_LAST) || null;
                })();
                if (!chosenSeller) {
                    alert("Please select a seller.");
                    return;
                }

                const buy = parseFloat(document.getElementById("b_buy").value);
                const ship = parseFloat(document.getElementById("b_ship")?.value || "0");
                const sell = parseFloat(document.getElementById("b_sell").value);
                const file = document.getElementById("b_image").files[0];
                if (isNaN(buy) || !file) {
                    alert("Fill buy price and choose an image.");
                    return;
                }

                let imageUrl = "";
                try {
                    // Upload to Supabase (or fallback to local dataURL if not available)
                    imageUrl = await SupaStore.uploadCardImage(file);
                } catch (err) {
                    console.warn("Image upload failed; falling back to local dataURL", err);
                    imageUrl = await Img.compress(file, 1000, 0.7);
                }

                const name = Util.deriveNameFromFile(file);
                const item = {
                    id: Util.uid(),
                    seller: chosenSeller,
                    name,
                    buy: Number(buy),
                    ship: Number(isNaN(ship) ? 0 : ship),
                    sell: Number(isNaN(sell) ? buy : sell),
                    image: imageUrl,         // <-- now a Supabase URL
                    createdAt: Date.now(),
                };


                const arr = await Storage.load(KEYS.BOUGHT);
                arr.unshift(item);
                await Storage.save(KEYS.BOUGHT, arr);

                Storage.localSet(KEYS.SELLER_LAST, chosenSeller);
                document.getElementById("b_buy").value = "";
                document.getElementById("b_ship").value = "";
                document.getElementById("b_sell").value = "";
                document.getElementById("b_image").value = "";

                await renderBought();
                Util.ariaLiveAnnounce("Added new item to Inventory");
            });

            // Summary reset all
            const resetAllBtn = document.getElementById("resetAll");
            resetAllBtn?.addEventListener("click", async () => {
                if (
                    !confirm(
                        "Reset all Twicks data? This will remove bought, for-sale and sold items."
                    )
                )
                    return;
                Storage.localDel(KEYS.BOUGHT);
                Storage.localDel(KEYS.FORSALE);
                Storage.localDel(KEYS.SOLD);
                await Storage.save(KEYS.BOUGHT, []);
                await Storage.save(KEYS.FORSALE, []);
                await Storage.save(KEYS.SOLD, []);
                await renderBought();
                alert("All data cleared.");
            });
        }

        async function showManageSellersModal() {
            const sellersSet = new Set(await Storage.load(KEYS.SELLERS));
            const veil = document.createElement("div");
            veil.className = "modal-veil show";
            const card = document.createElement("div");
            card.className = "modal-card";
            card.style.maxWidth = "520px";
            card.innerHTML = `
        <h3>Manage Sellers</h3>
        <div class="modal-row">
          <div id="sellerList" style="display:flex;flex-direction:column;gap:8px;max-height:300px;overflow:auto;"></div>
        </div>
        <div class="modal-actions">
          <button class="btn secondary" id="closeMS">Close</button>
        </div>
      `;
            veil.appendChild(card);
            document.body.appendChild(veil);
            const close = () => document.body.removeChild(veil);
            veil.onclick = close;
            card.onclick = (e) => e.stopPropagation();
            card.querySelector("#closeMS").onclick = close;

            const list = card.querySelector("#sellerList");

            function renderList() {
                list.innerHTML = "";
                Array.from(sellersSet)
                    .sort((a, b) => a.localeCompare(b))
                    .forEach((name) => {
                        const row = document.createElement("div");
                        row.style.cssText =
                            "display:flex;align-items:center;gap:8px;justify-content:space-between";
                        row.innerHTML = `
              <div style="flex:1 1 auto">${Util.esc(name)}</div>
              <div>
                <button class="small-btn" data-act="rename" data-name="${Util.esc(
                            name
                        )}">Rename</button>
                <button class="small-btn" data-act="delete" data-name="${Util.esc(
                            name
                        )}">Delete</button>
              </div>
            `;
                        list.appendChild(row);
                    });
            }
            renderList();

            list.onclick = async (e) => {
                const btn = e.target.closest("button");
                if (!btn) return;
                const act = btn.dataset.act;
                const name = btn.dataset.name;
                if (act === "rename") {
                    const nn = prompt("New name for seller:", name)?.trim();
                    if (!nn || nn === name) return;
                    sellersSet.delete(name);
                    sellersSet.add(nn);
                    await Storage.save(KEYS.SELLERS, Array.from(sellersSet));
                    const bought = await Storage.load(KEYS.BOUGHT);
                    bought.forEach((i) => {
                        if ((i.seller || "") === name) i.seller = nn;
                    });
                    await Storage.save(KEYS.BOUGHT, bought);
                    const fs = await Storage.load(KEYS.FORSALE);
                    fs.forEach((i) => {
                        if ((i.seller || "") === name) i.seller = nn;
                    });
                    await Storage.save(KEYS.FORSALE, fs);
                    if (Storage.localGet(KEYS.SELLER_LAST) === name)
                        Storage.localSet(KEYS.SELLER_LAST, nn);
                    renderList();
                    alert("Seller renamed.");
                } else if (act === "delete") {
                    if (
                        !confirm(
                            `Delete seller "${name}" from list?\nYou can optionally reassign their items.`
                        )
                    )
                        return;
                    let reassignTo = prompt(
                        "Type a seller name to reassign items to (leave blank to clear):"
                    )?.trim();
                    if (reassignTo) {
                        sellersSet.add(reassignTo);
                    }
                    const bought = await Storage.load(KEYS.BOUGHT);
                    bought.forEach((i) => {
                        if ((i.seller || "") === name)
                            i.seller = reassignTo ? reassignTo : "";
                    });
                    await Storage.save(KEYS.BOUGHT, bought);
                    const fs = await Storage.load(KEYS.FORSALE);
                    fs.forEach((i) => {
                        if ((i.seller || "") === name)
                            i.seller = reassignTo ? reassignTo : "";
                    });
                    await Storage.save(KEYS.FORSALE, fs);
                    sellersSet.delete(name);
                    await Storage.save(KEYS.SELLERS, Array.from(sellersSet));
                    if (Storage.localGet(KEYS.SELLER_LAST) === name)
                        Storage.localDel(KEYS.SELLER_LAST);
                    renderList();
                    alert("Seller removed.");
                }
            };
        }

        async function init() {
            container = document.getElementById("boughtContainer");
            if (!container) return;

            injectShipInField();

            const sellerSelect = document.getElementById("b_seller_select");
            await populateSellerSelect(sellerSelect);

            bindEvents();
            await renderBought();
        }

        return { init, renderBought };
    })();

    /* =========================================
       FOR SALE PAGE (forsale.html)
    ========================================= */
    const ForSale = (() => {
        let grid, buyerSelect, manageBuyersBtn, tabsBar, priceInput, fileInput;

        async function getBuyers() {
            const set = new Set(await Storage.load(KEYS.BUYERS));
            (await Storage.load(KEYS.SOLD)).forEach((i) => i.buyer && set.add(i.buyer));
            (await Storage.load(KEYS.FORSALE)).forEach((i) => i.buyer && set.add(i.buyer));
            return Array.from(set).filter(Boolean).sort((a, b) => a.localeCompare(b));
        }
        async function addBuyer(name) {
            if (!name) return;
            const set = new Set(await Storage.load(KEYS.BUYERS));
            set.add(name);
            await Storage.save(KEYS.BUYERS, Array.from(set));
        }
        async function populateBuyerSelect() {
            if (!buyerSelect) return;
            const buyers = await getBuyers();
            const last = Storage.localGet(KEYS.BUYER_LAST) || "";
            buyerSelect.innerHTML = `
        <option value="">— Select Buyer —</option>
        ${buyers.map((b) => `<option value="${Util.esc(b)}">${Util.esc(b)}</option>`).join("")}
        <option value="__new__">➕ Add new buyer…</option>
      `;
            if (last && buyers.includes(last)) buyerSelect.value = last;
        }
        async function chooseBuyerFlow() {
            if (!buyerSelect) return null;
            if (buyerSelect.value === "__new__") {
                const name = prompt("New buyer name:")?.trim();
                if (!name) {
                    buyerSelect.value = "";
                    return null;
                }
                await addBuyer(name);
                await populateBuyerSelect();
                buyerSelect.value = name;
                Storage.localSet(KEYS.BUYER_LAST, name);
                return name;
            }
            if (!buyerSelect.value) return null;
            Storage.localSet(KEYS.BUYER_LAST, buyerSelect.value);
            return buyerSelect.value;
        }

        function ensureBuyerBar() {
            // already present in your HTML, but we keep it aligned
            buyerSelect = document.getElementById("fs_buyer_select");
            manageBuyersBtn = document.getElementById("manageBuyersBtn");
            if (manageBuyersBtn && !manageBuyersBtn.dataset.bound) {
                manageBuyersBtn.dataset.bound = "1";
                manageBuyersBtn.addEventListener("click", showManageBuyersModal);
            }
            buyerSelect?.addEventListener("change", chooseBuyerFlow);
        }

        async function showManageBuyersModal() {
            const buyersSet = new Set(await Storage.load(KEYS.BUYERS));
            const veil = document.createElement("div");
            veil.className = "modal-veil show";
            const card = document.createElement("div");
            card.className = "modal-card";
            card.style.maxWidth = "520px";
            card.innerHTML = `
        <h3>Manage Buyers</h3>
        <div class="modal-row">
          <div id="buyerList" style="display:flex;flex-direction:column;gap:8px;max-height:300px;overflow:auto;"></div>
        </div>
        <div class="modal-actions">
          <button class="btn secondary" id="closeMB">Close</button>
        </div>`;
            veil.appendChild(card);
            document.body.appendChild(veil);
            const close = () => document.body.removeChild(veil);
            veil.onclick = close;
            card.onclick = (e) => e.stopPropagation();
            card.querySelector("#closeMB").onclick = close;

            const list = card.querySelector("#buyerList");

            function render() {
                list.innerHTML = "";
                Array.from(buyersSet)
                    .sort((a, b) => a.localeCompare(b))
                    .forEach((name) => {
                        const row = document.createElement("div");
                        row.style.cssText =
                            "display:flex;align-items:center;gap:8px;justify-content:space-between";
                        row.innerHTML = `
              <div style="flex:1 1 auto">${Util.esc(name)}</div>
              <div>
                <button class="small-btn" data-act="rename" data-name="${Util.esc(
                            name
                        )}">Rename</button>
                <button class="small-btn" data-act="delete" data-name="${Util.esc(
                            name
                        )}">Delete</button>
              </div>`;
                        list.appendChild(row);
                    });
            }
            render();

            list.onclick = async (e) => {
                const btn = e.target.closest("button");
                if (!btn) return;
                const act = btn.dataset.act;
                const name = btn.dataset.name;
                if (act === "rename") {
                    const nn = prompt("New name for buyer:", name)?.trim();
                    if (!nn || nn === name) return;
                    buyersSet.delete(name);
                    buyersSet.add(nn);
                    await Storage.save(KEYS.BUYERS, Array.from(buyersSet));

                    const sold = await Storage.load(KEYS.SOLD);
                    sold.forEach((i) => {
                        if ((i.buyer || "") === name) i.buyer = nn;
                    });
                    await Storage.save(KEYS.SOLD, sold);

                    const fs = await Storage.load(KEYS.FORSALE);
                    fs.forEach((i) => {
                        if ((i.buyer || "") === name) i.buyer = nn;
                    });
                    await Storage.save(KEYS.FORSALE, fs);

                    if (Storage.localGet(KEYS.BUYER_LAST) === name)
                        Storage.localSet(KEYS.BUYER_LAST, nn);

                    render();
                    alert("Buyer renamed.");
                }
                if (act === "delete") {
                    if (
                        !confirm(
                            `Delete buyer "${name}" from list?\nExisting SOLD/FS entries will keep the name.`
                        )
                    )
                        return;
                    buyersSet.delete(name);
                    await Storage.save(KEYS.BUYERS, Array.from(buyersSet));
                    if (Storage.localGet(KEYS.BUYER_LAST) === name)
                        Storage.localDel(KEYS.BUYER_LAST);
                    render();
                    alert("Buyer removed.");
                }
            };
        }

        let activeSeller = "__ALL__";

        async function renderGrid() {
            const sumForSaleEl = document.getElementById("sumForSale");
            const sumForSaleValEl = document.getElementById("sumForSaleValue");

            const items = await Storage.load(KEYS.FORSALE);
            const sellers = Array.from(
                new Set(items.map((i) => i.seller || "(No seller)"))
            ).sort((a, b) => a.localeCompare(b));

            // tabs
            tabsBar.innerHTML = "";
            const mkTab = (label, value) => {
                const b = document.createElement("button");
                b.className = "btn secondary";
                b.textContent = label;
                b.style.cssText = `padding:6px 10px;border-radius:10px;${activeSeller === value ? "outline:2px solid var(--primary)" : ""
                    }`;
                b.onclick = () => {
                    activeSeller = value;
                    renderGrid();
                };
                return b;
            };
            tabsBar.appendChild(mkTab("All", "__ALL__"));
            sellers.forEach((s) => tabsBar.appendChild(mkTab(s, s)));

            const view =
                activeSeller === "__ALL__"
                    ? items
                    : items.filter((i) => (i.seller || "(No seller)") === activeSeller);

            if (sumForSaleEl) sumForSaleEl.textContent = items.length;
            if (sumForSaleValEl)
                sumForSaleValEl.textContent = Util.fmtMoney(
                    items.reduce((a, b) => a + Number(b.price || 0), 0)
                );

            // info bar (potential profit + active buyer)
            let infoBar = document.getElementById("fsInfoBar");
            if (!infoBar) {
                infoBar = document.createElement("div");
                infoBar.id = "fsInfoBar";
                infoBar.style.cssText = "margin:4px 6px 10px 6px;opacity:.9;";
                tabsBar.parentElement.insertBefore(infoBar, grid);
            }
            const buyerName = Storage.localGet(KEYS.BUYER_LAST) || "—";
            if (activeSeller === "__ALL__") {
                const pot = items.reduce(
                    (s, i) => s + (Number(i.price || 0) - Number(i.buy || 0)),
                    0
                );
                infoBar.textContent = `Overall potential profit: ${Util.fmtMoney(
                    pot
                )} • Buyer: ${buyerName}`;
            } else {
                const pot = view.reduce(
                    (s, i) => s + (Number(i.price || 0) - Number(i.buy || 0)),
                    0
                );
                infoBar.textContent = `Seller: ${activeSeller} • Items: ${view.length
                    } • Potential profit: ${Util.fmtMoney(pot)} • Buyer: ${buyerName}`;
            }

            // render cards
            const frag = document.createDocumentFragment();
            view.forEach((it) => {
                const d = document.createElement("div");
                d.className = "card panel";
                const pot = Number(it.price || 0) - Number(it.buy || 0);
                d.innerHTML = `
          <div class="img-wrap">
            <img src="${it.image}" alt="${Util.esc(it.name)}">
            <div class="price-badge">${Util.fmtMoney(it.price)}</div>
          </div>
          <div class="info">
            <div class="title">${Util.esc(it.name)}</div>
            <div class="meta">Seller: ${Util.esc(it.seller || "(No seller)")}</div>
            <div class="meta">Buy: ${Util.fmtMoney(
                    it.buy || 0
                )} • Pot: <strong>${(pot >= 0 ? "+" : "") + Util.fmtMoney(pot)}</strong></div>
            <div class="card-actions">
              <button class="small-btn mark-sold" data-id="${it.id}">Sold</button>
              <button class="small-btn delete-item" data-id="${it.id}">🗑️</button>
            </div>
          </div>`;
                frag.appendChild(d);
            });

            Util.rafBatch(() => {
                grid.innerHTML = "";
                grid.appendChild(frag);
            });
        }

        function bindEvents() {
            // grid delegation
            grid.addEventListener("click", (e) => {
                const img = e.target.closest(".img-wrap img");
                if (img) {
                    UI.openImageModal(img.src, img.alt);
                    return;
                }

                const delBtn = e.target.closest(".delete-item");
                if (delBtn) {
                    e.preventDefault();
                    (async () => {
                        const id = delBtn.dataset.id;
                        const arr = (await Storage.load(KEYS.FORSALE)).filter(
                            (x) => x.id !== id
                        );
                        await Storage.save(KEYS.FORSALE, arr);
                        await renderGrid();
                    })();
                    return;
                }

                const soldBtn = e.target.closest(".mark-sold");
                if (soldBtn) {
                    e.preventDefault();
                    (async () => {
                        let buyer = buyerSelect ? buyerSelect.value : "";
                        if (buyer === "__new__") {
                            buyer = (await chooseBuyerFlow()) || "";
                        }
                        if (!buyer) {
                            buyer = prompt("Buyer name:")?.trim() || "Unknown";
                            if (buyer && buyer !== "Unknown") {
                                await addBuyer(buyer);
                                await populateBuyerSelect();
                                if (buyerSelect) buyerSelect.value = buyer;
                                Storage.localSet(KEYS.BUYER_LAST, buyer);
                            }
                        }
                        const fs = await Storage.load(KEYS.FORSALE);
                        const i = fs.findIndex((x) => x.id === soldBtn.dataset.id);
                        if (i === -1) return;
                        const item = fs.splice(i, 1)[0];
                        item.buyer = buyer || "Unknown";
                        item.soldAt = Date.now();
                        item.status = "Pending";
                        await Storage.save(KEYS.FORSALE, fs);
                        const sold = await Storage.load(KEYS.SOLD);
                        sold.unshift(item);
                        await Storage.save(KEYS.SOLD, sold);
                        await renderGrid();
                    })();
                    return;
                }
            });

            // add new listing
            const addBtn = document.getElementById("addForSaleBtn");
            addBtn?.addEventListener("click", async () => {
                const price = parseFloat(priceInput.value);
                const file = fileInput.files[0];
                if (isNaN(price) || !file) {
                    alert("Enter price and select image.");
                    return;
                }
                let imgUrl = "";
                try {
                    imgUrl = await SupaStore.uploadCardImage(file);
                } catch (err) {
                    console.warn("Image upload failed; falling back to local dataURL", err);
                    imgUrl = await Img.compress(file, 1000, 0.7);
                }

                const arr = await Storage.load(KEYS.FORSALE);
                arr.unshift({
                    id: Util.uid(),
                    name: Util.deriveNameFromFile(file),
                    price,
                    image: imgUrl,   // <-- Supabase URL
                    buy: 0,
                    seller: "",
                });

                await Storage.save(KEYS.FORSALE, arr);
                priceInput.value = "";
                fileInput.value = "";
                await renderGrid();
            });
        }

        async function init() {
            grid = document.getElementById("grid");
            if (!grid || document.getElementById("soldContainer")) return;

            priceInput = document.getElementById("f_price");
            fileInput = document.getElementById("f_image");

            ensureBuyerBar();
            await populateBuyerSelect();

            // tabs
            tabsBar = document.createElement("div");
            tabsBar.id = "fsTabs";
            tabsBar.style.cssText =
                "display:flex;gap:8px;flex-wrap:wrap;margin:8px 6px 14px 6px;";
            grid.parentElement.insertBefore(tabsBar, grid);

            bindEvents();
            await renderGrid();
        }

        return { init };
    })();

    /* =========================================
       SOLD PAGE (sold.html)
    ========================================= */
    const Sold = (() => {
        let container;

        function greetingNow() {
            const h = new Date().getHours();
            return "Good " + (h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Evening");
        }

        async function render() {
            const sumSoldCount = document.getElementById("sumSoldCount");
            const sumSoldValue = document.getElementById("sumSoldValue");
            const sumSoldPendingValue = document.getElementById("sumSoldPendingValue");
            const sumSoldPaidCount = document.getElementById("sumSoldPaidCount");
            const sumSoldPendingCount = document.getElementById("sumSoldPendingCount");

            const sold = await Storage.load(KEYS.SOLD);
            const shipMapRaw = await Storage.load(KEYS.SHIP_OUT_MAP);
            const shipping =
                typeof shipMapRaw === "object" && !Array.isArray(shipMapRaw)
                    ? shipMapRaw
                    : {};

            const paidItems = sold.filter((i) => (i.status || "Pending") === "Paid");
            const pendingItems = sold.filter((i) => (i.status || "Pending") !== "Paid");
            const paidRevenue = paidItems.reduce((s, i) => s + Number(i.price || 0), 0);
            const pendingRevenue = pendingItems.reduce(
                (s, i) => s + Number(i.price || 0),
                0
            );

            if (sumSoldCount) sumSoldCount.textContent = sold.length;
            if (sumSoldValue) sumSoldValue.textContent = Util.fmtMoney(paidRevenue);
            if (sumSoldPendingValue)
                sumSoldPendingValue.textContent = Util.fmtMoney(pendingRevenue);
            if (sumSoldPaidCount) sumSoldPaidCount.textContent = paidItems.length;
            if (sumSoldPendingCount)
                sumSoldPendingCount.textContent = pendingItems.length;

            const byBuyer = {};
            sold.forEach((item) => {
                const b = item.buyer || "Unknown";
                (byBuyer[b] ||= []).push(item);
            });

            const rows = Object.keys(byBuyer).map((buyer) => {
                const list = byBuyer[buyer];
                const hasPending = list.some((i) => (i.status || "Pending") !== "Paid");
                const allPaid = !hasPending;
                const latest = Math.max(...list.map((i) => i.soldAt || i.createdAt || 0));
                const gross = list.reduce((s, i) => s + Number(i.price || 0), 0);
                const sf = Number(shipping[buyer] || 0);
                const net = gross - sf;
                return { buyer, list, allPaid, hasPending, latest, gross, sf, net };
            });

            const paidBottom = (Storage.localGet(KEYS.PREF_PAID_BOTTOM) ?? "1") === "1";
            rows.sort((a, b) => {
                if (paidBottom) {
                    if (a.allPaid !== b.allPaid) return a.allPaid ? 1 : -1;
                }
                return b.latest - a.latest;
            });

            const frag = document.createDocumentFragment();

            rows.forEach(({ buyer, list, allPaid, hasPending, gross, sf, net }) => {
                const pendingCount = list.filter(
                    (i) => (i.status || "Pending") !== "Paid"
                ).length;

                const block = document.createElement("div");
                block.className = "buyer-block panel" + (allPaid ? " paid" : "");
                block.dataset.buyer = buyer;

                const multi = list.length > 1;
                const showMarkAllPaid = multi && hasPending;

                const header = document.createElement("div");
                header.className = "buyer-header";
                header.innerHTML = `
          <div style="display:flex;align-items:flex-start;gap:12px;flex:1;">
            <div>
              <div class="buyer-title">${Util.esc(buyer)}</div>
              <div class="buyer-meta">
                ${list.length} item(s) • Gross: ${Util.fmtMoney(gross)} • SF: ${Util.fmtMoney(
                    sf
                )} • Net: <strong>${Util.fmtMoney(net)}</strong> • ${pendingCount} pending
              </div>
            </div>
          </div>
          <div>
            <button class="btn secondary toggle-block">Collapse</button>
          </div>`;
                block.appendChild(header);

                const content = document.createElement("div");
                content.className = "buyer-content";
                content.style.cssText =
                    "display:flex;gap:16px;align-items:flex-start;margin-top:12px;";

                const cardsWrap = document.createElement("div");
                cardsWrap.className = "buyer-cards";
                cardsWrap.style.flex = "1 1 auto";
                if (allPaid) content.style.display = "none";

                list.forEach((item) => {
                    const status = item.status || "Pending";
                    const isPaid = status === "Paid";
                    const card = document.createElement("div");
                    card.className = "card";
                    card.dataset.id = item.id;
                    card.innerHTML = `
            <div class="img-wrap"><img src="${item.image}" alt="${Util.esc(
                        item.name
                    )}" /></div>
            <div class="info">
              <div class="title">${Util.esc(item.name)}</div>
              <div class="meta">${Util.fmtMoney(item.price)}</div>
              <div class="meta">${dateFmt.format(
                        new Date(item.soldAt || item.createdAt || Date.now())
                    )}</div>
              <div class="status-row">
                <span class="status-pill ${isPaid ? "paid" : "pending"}">${isPaid ? "Paid" : "Pending"
                        }</span>
                ${!isPaid && !(multi && hasPending)
                            ? `<button class="small-btn mark-paid" data-id="${item.id}">Mark Paid</button>`
                            : ``}
                <button class="small-btn delete-item" data-id="${item.id}" title="Delete">🗑️</button>
              </div>
            </div>
          `;
                    cardsWrap.appendChild(card);
                });

                const actions = document.createElement("div");
                actions.className = "buyer-actions-right";

                actions.innerHTML = !allPaid
                    ? `
        <button class="btn primary total-invoice">Total Invoice</button>
        <button class="btn secondary follow-up">Followup invoice</button>
        <button class="btn secondary nonimg-followup">non followup</button>
        ${showMarkAllPaid ? `<button class="btn btn-rgb mark-all-paid">Mark all as paid</button>` : ``}
        <button class="btn secondary set-sf">Set Shipping Fee</button>
        <button class="btn secondary ship-msg-btn" data-buyer="${buyer}">Shipping Msg</button>
    `
                    : `
        <button class="btn primary thanks-invoice">Thanks invoice</button>
        <button class="btn secondary add-to-cash">Add to Cash</button>
        <button class="btn secondary set-sf">Set Shipping Fee</button>
        <button class="btn secondary ship-msg-btn" data-buyer="${buyer}">Shipping Msg</button>
    `;



                content.appendChild(cardsWrap);
                content.appendChild(actions);
                block.appendChild(content);
                frag.appendChild(block);
            });

            Util.rafBatch(() => {
                container.innerHTML = "";
                container.appendChild(frag);
            });
        }

        function bindEvents() {
            // greeting select
            const greetSelect = document.getElementById("greetSelect");
            if (greetSelect) {
                const saved =
                    Storage.localGet(KEYS.GREET) || Util.nowGreetingKey();
                greetSelect.value = saved;
                greetSelect.addEventListener("change", () =>
                    Storage.localSet(KEYS.GREET, greetSelect.value)
                );
            }

            // controls
            const prefToggleId = "paidBottomToggle";
            (function injectPrefToggle() {
                if (document.getElementById("soldControls")) return;
                const controls = document.createElement("div");
                controls.id = "soldControls";
                controls.style.cssText =
                    "display:flex;gap:12px;align-items:center;margin:0 0 10px 6px;";
                const paidBottom = (Storage.localGet(KEYS.PREF_PAID_BOTTOM) ?? "1") === "1";
                controls.innerHTML = `
          <label style="display:inline-flex;gap:8px;align-items:center;cursor:pointer;">
            <input type="checkbox" id="${prefToggleId}" ${paidBottom ? "checked" : ""} />
            <span>Send fully-paid buyers to bottom</span>
          </label>`;
                (container?.parentElement || document.body).insertBefore(
                    controls,
                    container
                );
                controls
                    .querySelector("#" + prefToggleId)
                    .addEventListener("change", (e) => {
                        Storage.localSet(KEYS.PREF_PAID_BOTTOM, e.target.checked ? "1" : "0");
                        render();
                    });
            })();

            // delegation
            container.addEventListener("click", (e) => {
                const img = e.target.closest(".img-wrap img");
                if (img) {
                    UI.openImageModal(img.src, img.alt);
                    return;
                }

                const totalInvoice = e.target.closest(".total-invoice");
                if (totalInvoice) {
                    const block = totalInvoice.closest(".buyer-block");
                    const cards = Array.from(block.querySelectorAll(".buyer-cards .card"));
                    const total = cards.reduce((s, el) => {
                        const m = (el.querySelector(".meta")?.textContent || "").match(
                            /₱\s?[\d,]+(?:\.\d{2})?/
                        );
                        return s + (m ? Number(m[0].replace(/[₱,\s]/g, "")) : 0);
                    }, 0);
                    const GREET = greetingNow();
                    const GCASH = "09284281430";
                    const MASKEDNAME = "A****' L**s M.";
                    const invoice = `${GREET} brother, here's your tab:

Total: ${Util.fmtMoney(total)}
GCash: ${GCASH}
${MASKEDNAME}

Can safekeep once paid, thank you!

Scheduled Shipping is via JNT only.

Thanks for your support. God bless!`;
                    navigator.clipboard
                        .writeText(invoice)
                        .then(() => alert("Invoice copied."))
                        .catch(() => prompt("Copy (Ctrl+C):", invoice));
                    return;
                }

                const thanks = e.target.closest(".thanks-invoice");
                if (thanks) {
                    const msg = `Received brother, Thanks!`;
                    navigator.clipboard
                        .writeText(msg)
                        .then(() => alert("Thanks invoice copied."))
                        .catch(() => prompt("Copy (Ctrl+C):", msg));
                    return;
                }

                const follow = e.target.closest(".follow-up");
                if (follow) {
                    const GREET = Util.greetingWord();
                    const msg = `${GREET} brother, soft reminder lang po sa payment. Thanks!`;
                    navigator.clipboard
                        .writeText(msg)
                        .then(() => alert("Follow-up copied."))
                        .catch(() => prompt("Copy (Ctrl+C):", msg));
                    return;
                }

                const nonimg = e.target.closest(".nonimg-followup");
                if (nonimg) {
                    const msg = `Will send pictures brother after ko masort. Thanks!`;
                    navigator.clipboard
                        .writeText(msg)
                        .then(() => alert("Non-imaged follow up copied."))
                        .catch(() => prompt("Copy (Ctrl+C):", msg));
                    return;
                }

                const tgl = e.target.closest(".toggle-block");
                if (tgl) {
                    const block = tgl.closest(".buyer-block");
                    const content = block.querySelector(".buyer-content");
                    if (!content) return;
                    const hidden = content.style.display === "none";
                    content.style.display = hidden ? "" : "none";
                    tgl.textContent = hidden ? "Collapse" : "Expand";
                    return;
                }

                const markAll = e.target.closest(".mark-all-paid");
                if (markAll) {
                    (async () => {
                        const block = markAll.closest(".buyer-block");
                        const buyer = block?.dataset?.buyer || "";
                        const sold = await Storage.load(KEYS.SOLD);
                        let changed = 0;
                        sold.forEach((it) => {
                            if ((it.buyer || "Unknown") === buyer && (it.status || "Pending") !== "Paid") {
                                it.status = "Paid";
                                changed++;
                            }
                        });
                        if (!changed) {
                            alert("Nothing to mark as paid.");
                            return;
                        }
                        await Storage.save(KEYS.SOLD, sold);
                        await render();
                    })();
                    return;
                }

                const markPaid = e.target.closest(".mark-paid");
                if (markPaid) {
                    (async () => {
                        const id = markPaid.dataset.id;
                        const sold = await Storage.load(KEYS.SOLD);
                        const idx = sold.findIndex((x) => x.id === id);
                        if (idx === -1) {
                            alert("Item not found");
                            return;
                        }
                        sold[idx].status = "Paid";
                        await Storage.save(KEYS.SOLD, sold);
                        await render();
                    })();
                    return;
                }

                const setSf = e.target.closest(".set-sf");
                if (setSf) {
                    (async () => {
                        const block = setSf.closest(".buyer-block");
                        const buyer = block?.dataset?.buyer || "Unknown";
                        const map = await Storage.load(KEYS.SHIP_OUT_MAP);
                        const cur = Number(map?.[buyer] || 0);
                        const v = prompt(
                            `Shipping fee you paid for "${buyer}" (₱):`,
                            String(cur)
                        )?.trim();
                        if (v == null) return;
                        const n = Number(v);
                        if (isNaN(n)) {
                            alert("Please enter a valid number.");
                            return;
                        }
                        const newMap =
                            typeof map === "object" && !Array.isArray(map) ? map : {};
                        newMap[buyer] = n;
                        await Storage.save(KEYS.SHIP_OUT_MAP, newMap);
                        await render();
                    })();
                    return;
                }

                const addCash = e.target.closest(".add-to-cash");
                if (addCash) {
                    (async () => {
                        const block = addCash.closest(".buyer-block");
                        const buyer = block?.dataset?.buyer || "Unknown";
                        const sold = await Storage.load(KEYS.SOLD);
                        const list = sold.filter((i) => (i.buyer || "Unknown") === buyer);
                        const allPaid = list.every((i) => (i.status || "Pending") === "Paid");
                        if (!allPaid) {
                            alert("This buyer is not fully paid yet.");
                            return;
                        }
                        const total = list.reduce((s, i) => s + Number(i.price || 0), 0);

                        const veil = document.createElement("div");
                        veil.className = "modal-veil show";
                        const card = document.createElement("div");
                        card.className = "modal-card";
                        card.innerHTML = `
              <h3>Add to Cash</h3>
              <div class="modal-row"><label>Source</label>
                <select id="cashSrc">
                  <option value="GCash">GCash</option>
                  <option value="SeaBank">SeaBank</option>
                  <option value="Cash">Cash</option>
                </select>
              </div>
              <div class="modal-row"><label>Amount</label>
                <input id="cashAmt" type="number" step="0.01" value="${Number(
                            total
                        ).toFixed(2)}"/>
              </div>
              <div class="modal-row"><label>Note</label>
                <input id="cashNote" type="text" value="Paid by ${Util.esc(buyer)}" />
              </div>
              <div class="modal-actions">
                <button class="btn secondary" id="cancelAddCash">Cancel</button>
                <button class="btn primary" id="okAddCash">Add</button>
              </div>`;
                        veil.appendChild(card);
                        document.body.appendChild(veil);
                        const close = () => document.body.removeChild(veil);
                        card.onclick = (e2) => e2.stopPropagation();
                        veil.onclick = close;
                        card.querySelector("#cancelAddCash").onclick = close;
                        card.querySelector("#okAddCash").onclick = async () => {
                            const src = card.querySelector("#cashSrc").value;
                            const amt = parseFloat(card.querySelector("#cashAmt").value);
                            const note = (card.querySelector("#cashNote").value || "").trim();
                            if (!src || isNaN(amt) || amt <= 0) {
                                alert("Please set a valid source/amount.");
                                return;
                            }
                            const items = await Storage.load(KEYS.CASH);
                            items.unshift({
                                id: Util.uid(),
                                source: src,
                                amount: Number(amt),
                                note,
                                createdAt: Date.now(),
                            });
                            await Storage.save(KEYS.CASH, items);
                            close();
                            alert("Added to Cash On Hand.");
                        };
                    })();
                    return;
                }

                const delBtn = e.target.closest(".delete-item");
                if (delBtn) {
                    (async () => {
                        const id = delBtn.dataset.id;
                        if (!confirm("Delete this item from Sold?")) return;
                        const sold = await Storage.load(KEYS.SOLD);
                        const idx = sold.findIndex((x) => x.id === id);
                        if (idx === -1) {
                            alert("Item not found");
                            return;
                        }
                        sold.splice(idx, 1);
                        await Storage.save(KEYS.SOLD, sold);
                        await render();
                    })();
                }
            });
        }

        async function init() {
            container = document.getElementById("soldContainer");
            if (!container || document.getElementById("grid")) return;

            // greet picker setup handled in bindEvents (reads & writes localStorage)
            bindEvents();
            await render();
        }

        return { init };
    })();


    /* =========================================
       CASH PAGE (cash.html)
    ========================================= */
    const Cash = (() => {
        let app;

        async function calcSoldRevenue() {
            const sold = await Storage.load(KEYS.SOLD);
            const paidItems = sold.filter((i) => (i.status || "Pending") === "Paid");
            const pendingItems = sold.filter((i) => (i.status || "Pending") !== "Paid");
            const paidRevenue = paidItems.reduce((s, i) => s + Number(i.price || 0), 0);
            const pendingRevenue = pendingItems.reduce(
                (s, i) => s + Number(i.price || 0),
                0
            );

            const revPaidCountEl = document.getElementById("revPaidCount");
            const revPaidValueEl = document.getElementById("revPaidValue");
            const revPendCountEl = document.getElementById("revPendCount");
            const revPendValueEl = document.getElementById("revPendValue");
            const revAllValueEl = document.getElementById("revAllValue");

            if (revPaidCountEl) revPaidCountEl.textContent = paidItems.length;
            if (revPaidValueEl) revPaidValueEl.textContent = Util.fmtMoney(paidRevenue);
            if (revPendCountEl) revPendCountEl.textContent = pendingItems.length;
            if (revPendValueEl) revPendValueEl.textContent = Util.fmtMoney(pendingRevenue);
            if (revAllValueEl) revAllValueEl.textContent = Util.fmtMoney(pendingRevenue);

            return { paidRevenue, pendingRevenue };
        }

        async function render() {
            const sumGCash = document.getElementById("sumGCash");
            const sumSea = document.getElementById("sumSea");
            const sumCash = document.getElementById("sumCash");
            const sumTotal = document.getElementById("sumTotalCash");
            const cashList = document.getElementById("cashList");

            const items = await Storage.load(KEYS.CASH);
            const totals = { GCash: 0, SeaBank: 0, Cash: 0 };
            items.forEach((i) => {
                totals[i.source] = (totals[i.source] || 0) + Number(i.amount || 0);
            });

            const onHandTotal =
                (totals.GCash || 0) + (totals.SeaBank || 0) + (totals.Cash || 0);

            if (sumGCash) sumGCash.textContent = Util.fmtMoney(totals.GCash || 0);
            if (sumSea) sumSea.textContent = Util.fmtMoney(totals.SeaBank || 0);
            if (sumCash) sumCash.textContent = Util.fmtMoney(totals.Cash || 0);
            if (sumTotal) sumTotal.textContent = Util.fmtMoney(onHandTotal);

            const { paidRevenue } = await calcSoldRevenue();

            const grandTotalEl = document.getElementById("grandTotalCash");
            const grandBreakdown = document.getElementById("grandBreakdown");
            const grand = onHandTotal + paidRevenue;
            if (grandTotalEl) grandTotalEl.textContent = Util.fmtMoney(grand);
            if (grandBreakdown)
                grandBreakdown.textContent = `On-hand ${Util.fmtMoney(
                    onHandTotal
                )} + Paid revenue ${Util.fmtMoney(paidRevenue)}`;

            // render rows
            const frag = document.createDocumentFragment();
            items.forEach((it) => {
                const amt = Number(it.amount || 0);
                const row = document.createElement("div");
                row.className = "cash-row";
                row.dataset.id = it.id;
                row.innerHTML = `
          <div class="left">
            <div>
              <span class="badge ${it.source === "GCash"
                        ? "badge-gcash"
                        : it.source === "SeaBank"
                            ? "badge-sea"
                            : "badge-cash"
                    }">${Util.esc(it.source)}</span>
              • <strong class="${amt < 0 ? "amount-neg" : "amount-pos"}">${Util.fmtSigned(amt)
                    }</strong>
            </div>
            <div class="meta">
              <span>${Util.esc(it.note || "")}</span>
              <span>•</span>
              <span>${dateFmt.format(new Date(it.createdAt))}</span>
            </div>
          </div>
          <div class="right">
            <button class="small-btn delete-cash">🗑️</button>
          </div>
        `;
                frag.appendChild(row);
            });

            Util.rafBatch(() => {
                cashList.innerHTML = "";
                cashList.appendChild(frag);
            });
        }

        function bindEvents() {
            const srcSel = document.getElementById("c_source");
            if (srcSel && !srcSel.children.length) {
                srcSel.innerHTML = `<option value="">— Select Source —</option>
          <option value="GCash">GCash</option>
          <option value="SeaBank">SeaBank</option>
          <option value="Cash">Cash</option>`;
            }

            function readInputs() {
                const source = (document.getElementById("c_source").value || "").trim();
                const amount = parseFloat(
                    String(document.getElementById("c_amount").value).replace(/,/g, "")
                );
                const note = (document.getElementById("c_note").value || "").trim();
                return { source, amount, note };
            }

            const addBtn = document.getElementById("addCashBtn");
            addBtn?.addEventListener("click", async () => {
                const { source, amount, note } = readInputs();
                if (!source) {
                    alert("Please select a source.");
                    return;
                }
                if (isNaN(amount) || amount <= 0) {
                    alert("Please enter a valid amount.");
                    return;
                }
                const items = await Storage.load(KEYS.CASH);
                items.unshift({
                    id: Util.uid(),
                    source,
                    amount: Number(amount),
                    note,
                    createdAt: Date.now(),
                });
                await Storage.save(KEYS.CASH, items);
                document.getElementById("c_source").value = "";
                document.getElementById("c_amount").value = "";
                document.getElementById("c_note").value = "";
                await render();
            });

            const deductBtn = document.getElementById("deductCashBtn");
            deductBtn?.addEventListener("click", async () => {
                const { source, amount, note } = readInputs();
                if (!source) {
                    alert("Please select a source.");
                    return;
                }
                if (isNaN(amount) || amount <= 0) {
                    alert("Please enter a valid amount to deduct.");
                    return;
                }
                const items = await Storage.load(KEYS.CASH);
                items.unshift({
                    id: Util.uid(),
                    source,
                    amount: -Math.abs(Number(amount)),
                    note: note || "Purchase deduction",
                    createdAt: Date.now(),
                });
                await Storage.save(KEYS.CASH, items);
                document.getElementById("c_source").value = "";
                document.getElementById("c_amount").value = "";
                document.getElementById("c_note").value = "";
                await render();
            });

            // delete via delegation
            document.getElementById("cashList")?.addEventListener("click", (e) => {
                const btn = e.target.closest(".delete-cash");
                if (!btn) return;
                (async () => {
                    const id = btn.closest(".cash-row").dataset.id;
                    const items = await Storage.load(KEYS.CASH);
                    const idx = items.findIndex((x) => x.id === id);
                    if (idx === -1) return;
                    items.splice(idx, 1);
                    await Storage.save(KEYS.CASH, items);
                    await render();
                })();
            });
        }

        async function init() {
            app = document.getElementById("cashApp");
            if (!app) return;
            bindEvents();
            await render();
        }

        return { init };
    })();

    /* =========================================
       BOOTSTRAP
    ========================================= */
    function initSummaryPanels() {
        // Keep your hoverable summary panels responsive with ESC close
        document.querySelectorAll(".summary-panel").forEach((panel) => {
            panel.setAttribute("role", "region");
            panel.setAttribute("aria-label", "Summary");
        });
    }
    function initGoogleButtons() {
        // ensure Drive buttons present on pages with .topbar
        Drive.installButtons();

        const headerBrand = document.querySelector(".topbar .branding");
        if (!headerBrand) return;

        // Existing "Auto Backup Now" button (Drive)
        if (!document.getElementById("btnAutoBackupNow")) {
            const btn = document.createElement("button");
            btn.id = "btnAutoBackupNow";
            btn.textContent = "☁️ Auto Backup Now";
            btn.className = "btn secondary";
            btn.style.marginLeft = "8px";
            btn.onclick = () => {
                AutoBackup.forceNow()
                    .then(() => alert("✅ Auto backup saved to Drive."))
                    .catch((e) =>
                        alert(e?.message || "Auto backup failed.")
                    );
            };
            headerBrand.appendChild(btn);
        }

        // NEW: Manual Cloud Backup button (Neon)
        if (!document.getElementById("btnCloudBackup")) {
            const btnCloud = document.createElement("button");
            btnCloud.id = "btnCloudBackup";
            btnCloud.textContent = "☁️ Cloud Backup";
            btnCloud.className = "btn secondary";
            btnCloud.style.marginLeft = "8px";
            btnCloud.onclick = () => {
                backupToCloud();
            };
            headerBrand.appendChild(btnCloud);
        }

        // NEW: Cloud Restore button (Neon)
        if (!document.getElementById("btnCloudRestore")) {
            const btnRestore = document.createElement("button");
            btnRestore.id = "btnCloudRestore";
            btnRestore.textContent = "☁️ Cloud Restore";
            btnRestore.className = "btn secondary";
            btnRestore.style.marginLeft = "8px";
            btnRestore.onclick = () => {
                restoreFromCloud();
            };
            headerBrand.appendChild(btnRestore);
        }
    }


    document.addEventListener("DOMContentLoaded", () => {
        UI.initModal();
        UI.markActiveNav();
        initSummaryPanels();
        initGoogleButtons();

        // Initialize per page
        Inventory.init();
        ForSale.init();
        Sold.init();
        Cash.init();
    });

    // public API (if ever needed)
    return {};
})();
