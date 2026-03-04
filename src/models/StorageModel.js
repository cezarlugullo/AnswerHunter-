/**
 * StorageModel.js
 * Manages binder data persistence using chrome.storage.local.
 */
export const StorageModel = {
    data: [],
    currentFolderId: 'root',

    /**
     * Normalizes a question string for consistent storage/lookup.
     * Must match normalizeSavedQuestion in PopupController._buildLiveCardData.
     */
    _normalizeKey(s) {
        return String(s || '')
            .replace(/\r\n/g, '\n')
            .replace(/^\s*(?:ENUNCIADO|STATEMENT)\s*[:\-]?\s*/i, '')
            .replace(/\n\s*(?:ALTERNATIVAS?|OPTIONS)\s*[:\-]?\s*\n/gi, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    },

    /**
     * Initializes storage, loading data from chrome.storage.local
     * @returns {Promise<void>}
     */
    _initFailed: false,

    async init() {
        return new Promise((resolve, reject) => {
            chrome.storage.local.get(['binderStructure'], (result) => {
                if (chrome.runtime.lastError) {
                    console.error('StorageModel: init failed:', chrome.runtime.lastError);
                    this._initFailed = true;
                    reject(new Error('StorageModel init failed: ' + chrome.runtime.lastError.message));
                    return;
                }
                this._initFailed = false;
                const localData = result?.binderStructure;
                if (Array.isArray(localData)) {
                    this.data = localData;
                } else {
                    this.data = [{ id: 'root', type: 'folder', title: 'Raiz', children: [] }];
                }
                resolve();
            });
        });
    },

    /**
     * Saves current state to storage.
     * Uses a queue to prevent concurrent writes.
     * @returns {Promise<void>}
     */
    _saveQueue: Promise.resolve(),

    async save() {
        this._saveQueue = this._saveQueue.then(() => this._doSave()).catch(() => this._doSave());
        return this._saveQueue;
    },

    async _doSave() {
        console.log('StorageModel: Salvando estrutura...', this.countItems());
        return new Promise((resolve, reject) => {
            chrome.storage.local.set({ binderStructure: this.data }, () => {
                if (chrome.runtime.lastError) {
                    console.error('StorageModel: Local save failed:', chrome.runtime.lastError);
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve();
            });
        });
    },

    /**
     * Total count of saved questions (recursive)
     * @param {Array} nodes 
     * @returns {number}
     */
    countItems(nodes = this.data) {
        let count = 0;
        for (const node of nodes) {
            if (node.type === 'question') count++;
            if (node.children) count += this.countItems(node.children);
        }
        return count;
    },

    /**
     * Finds a node (folder or item) by ID
     * @param {string} id 
     * @param {Array} nodes 
     * @returns {Object|null}
     */
    findNode(id, nodes = this.data) {
        for (const node of nodes) {
            if (node.id === id) return node;
            if (node.type === 'folder' && node.children) {
                const found = this.findNode(id, node.children);
                if (found) return found;
            }
        }
        return null;
    },

    /**
     * Adds a new question to the current folder
     * @param {string} question 
     * @param {string} answer 
     * @param {string} source 
     */
    async addItem(question, answer, source, extraContent = {}) {
        if (!this.data.length) await this.init();

        const normQ = this._normalizeKey(question);
        if (this.isSaved(normQ)) {
            return false;
        }

        const current = this.findNode(this.currentFolderId);
        if (current && current.type === 'folder') {
            // Strip heavy evidence fields from sources to keep binder storage lean
            const rawSources = Array.isArray(extraContent?.sources) ? extraContent.sources : null;
            const leanSources = rawSources
                ? rawSources.map(s => {
                    if (!s || typeof s !== 'object') return s;
                    const { evidenceBlock, pageText, rawContent, fullText, rawText, snippetExtended, ...rest } = s;
                    return rest;
                })
                : undefined;
            const mergedExtra = {
                ...(extraContent || {}),
                ...(leanSources !== undefined ? { sources: leanSources } : {})
            };
            const uid = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
            const baseSm2 = {
                interval: 0,
                repetition: 0,
                ef: 2.5,
                nextReview: '',
                lastRated: '',
                attempts: 0,
                correct: 0,
                errors: 0,
                mastered: false,
                tags: [],
                hintUsedLast: false
            };
            const mergedSm2 = {
                ...baseSm2,
                ...((mergedExtra && mergedExtra.sm2 && typeof mergedExtra.sm2 === 'object') ? mergedExtra.sm2 : {})
            };
            current.children.push({
                id: 'q' + uid,
                type: 'question',
                content: { question: normQ, answer, source, ...mergedExtra, sm2: mergedSm2 },
                createdAt: Date.now(),
                updatedAt: Date.now()
            });
            await this.save();
            return true;
        } else {
            console.error('StorageModel: Pasta atual inválida:', this.currentFolderId);
        }
        return false;
    },

    /**
     * Creates a new folder inside the current folder
     * @param {string} name 
     */
    async createFolder(name) {
        if (!name) return;
        const current = this.findNode(this.currentFolderId);
        if (current && current.type === 'folder') {
            current.children.push({
                id: 'f' + crypto.randomUUID().replace(/-/g, '').slice(0, 12),
                type: 'folder',
                title: name,
                children: [],
                createdAt: Date.now()
            });
            await this.save();
        }
    },

    /**
     * Checks if a question is already saved
     * @param {string} questionText 
     * @returns {boolean}
     */
    isSaved(questionText) {
        return this.findQuestionNodeByContent(questionText) !== null;
    },

    /**
     * Finds a saved question node by question text.
     * @param {string} questionText
     * @param {Array} nodes
     * @returns {Object|null}
     */
    findQuestionNodeByContent(questionText, nodes = this.data) {
        if (!questionText) return null;
        const needle = this._normalizeKey(questionText);
        const search = (nodes) => {
            for (const node of nodes) {
                if (node.type === 'question' && node.content && this._normalizeKey(node.content.question) === needle) return node;
                if (node.children) {
                    const found = search(node.children);
                    if (found) return found;
                }
            }
            return null;
        };
        return search(nodes);
    },

    /**
     * Returns whether a saved question is marked for review.
     * @param {string} questionText
     * @returns {boolean}
     */
    isReviewLater(questionText) {
        const node = this.findQuestionNodeByContent(questionText);
        return !!(node?.content?.reviewLater);
    },

    /**
     * Returns saved/review metadata for a question.
     * @param {string} questionText
     * @returns {{saved: boolean, reviewLater: boolean}}
     */
    getQuestionMeta(questionText) {
        const node = this.findQuestionNodeByContent(questionText);
        return {
            saved: !!node,
            reviewLater: !!(node?.content?.reviewLater)
        };
    },

    /**
     * Marks or unmarks a saved question as "review later".
     * @param {string} questionText
     * @param {boolean} enabled
     * @returns {Promise<boolean>}
     */
    async setReviewLater(questionText, enabled = true) {
        if (!this.data.length) await this.init();
        const node = this.findQuestionNodeByContent(questionText);
        if (!node?.content) return false;

        if (enabled) {
            node.content.reviewLater = true;
        } else {
            delete node.content.reviewLater;
        }

        await this.save();
        return true;
    },

    /**
     * Removes a question by content text
     * @param {string} questionText 
     * @returns {boolean} Sucesso
     */
    async removeByContent(questionText) {
        const normTarget = this._normalizeKey(questionText);
        const removeFromTree = (nodes) => {
            for (let i = 0; i < nodes.length; i++) {
                if (nodes[i].type === 'question' && nodes[i].content && this._normalizeKey(nodes[i].content.question) === normTarget) {
                    nodes.splice(i, 1);
                    return true;
                }
                if (nodes[i].children) {
                    if (removeFromTree(nodes[i].children)) return true;
                }
            }
            return false;
        };

        if (removeFromTree(this.data)) {
            await this.save();
            return true;
        }
        return false;
    },

    /**
     * Removes a node by ID
     * @param {string} id 
     * @returns {boolean} Sucesso
     */
    async deleteNode(id) {
        const removeFromTree = (nodes, targetId) => {
            for (let i = 0; i < nodes.length; i++) {
                if (nodes[i].id === targetId) {
                    nodes.splice(i, 1);
                    return true;
                }
                if (nodes[i].children) {
                    if (removeFromTree(nodes[i].children, targetId)) return true;
                }
            }
            return false;
        };

        if (removeFromTree(this.data, id)) {
            await this.save();
            return true;
        }
        return false;
    },

    /**
     * Moves an item to another folder
     * @param {string} itemId 
     * @param {string} targetFolderId 
     */
    async moveItem(itemId, targetFolderId) {
        if (itemId === targetFolderId) return;

        // Verify target exists BEFORE extracting the node (prevents data loss)
        const targetFolder = this.findNode(targetFolderId);
        if (!targetFolder || targetFolder.type !== 'folder') {
            console.error('StorageModel: moveItem target not found:', targetFolderId);
            return;
        }

        // Helper to remove and return the item
        const extractFromTree = (nodes, id) => {
            for (let i = 0; i < nodes.length; i++) {
                if (nodes[i].id === id) {
                    return nodes.splice(i, 1)[0];
                }
                if (nodes[i].children) {
                    const found = extractFromTree(nodes[i].children, id);
                    if (found) return found;
                }
            }
            return null;
        };

        const itemNode = extractFromTree(this.data, itemId);
        if (itemNode) {
            targetFolder.children.push(itemNode);
            await this.save();
        }
    },

    /**
     * Renames a folder
     * @param {string} folderId
     * @param {string} newName
     * @returns {Promise<boolean>}
     */
    async renameFolder(folderId, newName) {
        if (!newName) return false;
        const folder = this.findNode(folderId);
        if (!folder || folder.type !== 'folder') return false;
        folder.title = newName;
        await this.save();
        return true;
    },

    /**
     * Finds the parent node of a given ID
     * @param {string} childId
     * @param {Array} nodes
     * @returns {Object|null}
     */
    findParent(childId, nodes = this.data) {
        for (const node of nodes) {
            if (node.children) {
                for (const child of node.children) {
                    if (child.id === childId) return node;
                }
                const found = this.findParent(childId, node.children);
                if (found) return found;
            }
        }
        return null;
    },

    /**
     * Deletes a folder but moves its children to the parent folder
     * @param {string} folderId
     * @returns {Promise<boolean>}
     */
    async deleteFolderKeepChildren(folderId) {
        const folder = this.findNode(folderId);
        if (!folder || folder.type !== 'folder') return false;

        const parent = this.findParent(folderId);
        if (!parent || !parent.children) return false;

        const folderIndex = parent.children.findIndex(c => c.id === folderId);
        if (folderIndex === -1) return false;

        // Insert folder children at the folder's position in the parent
        const children = folder.children || [];
        parent.children.splice(folderIndex, 1, ...children);

        await this.save();
        return true;
    },

    /**
     * Clears everything (Factory Reset).
     * Creates a backup before wiping to allow recovery.
     */
    async clearAll() {
        try {
            await new Promise((resolve) => {
                chrome.storage.local.set({ binderStructure_backup: this.data }, () => {
                    if (chrome.runtime.lastError) {
                        console.warn('StorageModel: clearAll backup failed:', chrome.runtime.lastError);
                    }
                    resolve();
                });
            });
        } catch (_) { /* best-effort backup */ }
        this.data = [{ id: 'root', type: 'folder', title: 'Raiz', children: [] }];
        this.currentFolderId = 'root';
        await this.save();
    },

    /**
     * Imports data from a backup JSON.
     * Validates basic structure and creates a backup before overwriting.
     * @param {Array} importedData
     * @returns {Promise<boolean>} true if import succeeded
     */
    async importData(importedData) {
        if (!Array.isArray(importedData) || importedData.length === 0) return false;
        // Validate basic node shape
        for (const node of importedData) {
            if (!node || typeof node !== 'object' || !node.id || !node.type) {
                console.error('StorageModel: importData rejected — invalid node shape:', node);
                return false;
            }
        }
        // Backup current data before overwriting
        try {
            await new Promise((resolve) => {
                chrome.storage.local.set({ binderStructure_backup: this.data }, () => {
                    if (chrome.runtime.lastError) {
                        console.warn('StorageModel: import backup failed:', chrome.runtime.lastError);
                    }
                    resolve();
                });
            });
        } catch (_) { /* best-effort backup */ }
        this.data = importedData;
        this.currentFolderId = 'root';
        await this.save();
        return true;
    },

    /**
     * Returns all question nodes flattened
     * @param {Array} nodes
     * @returns {Array}
     */
    getAllQuestions(nodes = this.data) {
        const result = [];
        for (const node of nodes) {
            if (node.type === 'question') result.push(node);
            if (node.children) result.push(...this.getAllQuestions(node.children));
        }
        return result;
    },

    /**
     * Updates SM2 entry for a given question node id
     * @param {string} questionId
     * @param {Object} sm2Entry
     * @returns {Promise<boolean>}
     */
    async updateSm2(questionId, sm2Entry = {}) {
        if (!questionId || typeof sm2Entry !== 'object') return false;
        if (!this.data.length) await this.init();
        const node = this.findNode(questionId);
        if (!node || node.type !== 'question' || !node.content) return false;

        const baseSm2 = {
            interval: 0,
            repetition: 0,
            ef: 2.5,
            nextReview: '',
            lastRated: '',
            attempts: 0,
            correct: 0,
            errors: 0,
            mastered: false,
            tags: [],
            hintUsedLast: false
        };

        node.content.sm2 = {
            ...baseSm2,
            ...(node.content.sm2 || {}),
            ...sm2Entry
        };
        node.updatedAt = Date.now();
        await this.save();
        return true;
    },

    /**
     * Full export preserving pedagogical state
     * @returns {Promise<Object>}
     */
    async exportFull() {
        if (!this.data.length) await this.init();
        const xpData = await new Promise((resolve) => {
            chrome.storage.local.get(['ah_xpData'], (d) => {
                if (chrome.runtime.lastError) {
                    console.error('StorageModel: exportFull get xpData failed:', chrome.runtime.lastError);
                }
                resolve(d?.ah_xpData || {});
            });
        });
        return {
            version: 2,
            exportedAt: Date.now(),
            binderStructure: this.data,
            xpData
        };
    },

    /**
     * Imports full payload (v2) or legacy structure
     * @param {Object|Array} data
     * @returns {Promise<boolean>}
     */
    async importFull(data) {
        const isLegacy = Array.isArray(data) || (data && !data.version);
        const structure = isLegacy
            ? (Array.isArray(data) ? data : data?.binderStructure)
            : data?.binderStructure;

        if (!Array.isArray(structure)) return false;
        this.data = structure;
        this.currentFolderId = 'root';
        await this.save();

        if (!isLegacy && data?.xpData && typeof data.xpData === 'object') {
            await new Promise((resolve) => chrome.storage.local.set({ ah_xpData: data.xpData }, () => {
                if (chrome.runtime.lastError) {
                    console.error('StorageModel: importFull set xpData failed:', chrome.runtime.lastError);
                }
                resolve();
            }));
        }
        return true;
    },

    /**
     * Returns unseen/new question nodes
     * @param {number} limit
     * @returns {Array}
     */
    getNewQuestions(limit = 20) {
        const n = Number(limit) > 0 ? Number(limit) : 20;
        return this.getAllQuestions()
            .filter(q => !q?.content?.sm2?.lastRated)
            .slice(0, n);
    },

    /**
     * Returns due question nodes by date string YYYY-MM-DD
     * @param {string} todayStr
     * @returns {Array}
     */
    getDueQuestions(todayStr) {
        const today = todayStr || new Date().toISOString().slice(0, 10);
        return this.getAllQuestions().filter(q => {
            const next = q?.content?.sm2?.nextReview;
            return !next || next <= today;
        });
    },

    // ─── DISCIPLINAS ────────────────────────────────────────────

    /**
     * Returns the saved disciplines list from chrome.storage
     * @returns {Promise<Array>}
     */
    async getDisciplines() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['ah_disciplines'], (d) => {
                if (chrome.runtime.lastError) {
                    console.error('StorageModel: getDisciplines failed:', chrome.runtime.lastError);
                }
                resolve(d?.ah_disciplines || []);
            });
        });
    },

    /**
     * Persists the disciplines list to chrome.storage
     * @param {Array} list
     */
    async saveDisciplines(list) {
        return new Promise((resolve) => {
            chrome.storage.local.set({ ah_disciplines: list }, () => {
                if (chrome.runtime.lastError) {
                    console.error('StorageModel: saveDisciplines failed:', chrome.runtime.lastError);
                }
                resolve();
            });
        });
    },

    /**
     * Creates a new discipline. Returns existing if name already exists.
     * @param {string} name
     * @param {string} color hex color
     * @returns {Promise<Object>} The discipline object
     */
    async addDiscipline(name, color = '#FF6B6B') {
        const list = await this.getDisciplines();
        const nameTrim = name.trim();
        const exists = list.find(d => d.name.toLowerCase() === nameTrim.toLowerCase());
        if (exists) return exists;
        const disc = { id: 'd' + crypto.randomUUID().replace(/-/g, '').slice(0, 12), name: nameTrim, color, createdAt: Date.now() };
        list.push(disc);
        await this.saveDisciplines(list);
        // Sync to ah_hierarchy so Study tab sees it
        await this._syncAddToHierarchy(disc);
        return disc;
    },

    /**
     * Deletes a discipline by id
     * @param {string} id
     */
    async deleteDiscipline(id) {
        const list = await this.getDisciplines();
        await this.saveDisciplines(list.filter(d => d.id !== id));
        // Sync removal to ah_hierarchy so Study tab sees it
        await this._syncDeleteFromHierarchy(id);
    },

    /**
     * Renames a discipline
     * @param {string} id
     * @param {string} newName
     */
    async renameDiscipline(id, newName) {
        const list = await this.getDisciplines();
        const disc = list.find(d => d.id === id);
        if (disc) {
            disc.name = newName.trim();
            await this.saveDisciplines(list);
            // Sync rename to ah_hierarchy so Study tab sees it
            await this._syncRenameInHierarchy(id, newName.trim());
        }
    },

    /**
     * Sets the discipline (subject) on an existing question node
     * @param {string} questionId  node id (e.g. "q1234567890")
     * @param {string} disciplineName
     * @returns {Promise<boolean>}
     */
    async setQuestionDiscipline(questionId, disciplineName) {
        if (!questionId) return false;
        if (!this.data.length) await this.init();
        const node = this.findNode(questionId);
        if (!node || node.type !== 'question' || !node.content) return false;
        node.content.subject = disciplineName || '';
        node.updatedAt = Date.now();
        await this.save();
        return true;
    },

    /**
     * Returns all question nodes belonging to a given discipline name
     * @param {string} disciplineName
     * @returns {Array}
     */
    getQuestionsByDiscipline(disciplineName) {
        return this.getAllQuestions().filter(q => {
            const s = q?.content?.subject || q?.content?.topic || q?.content?.discipline || '';
            return s.toLowerCase() === disciplineName.toLowerCase();
        });
    },

    // ─── Hierarchy sync helpers (ah_disciplines ↔ ah_hierarchy) ──────

    async _getHierarchy() {
        return new Promise(resolve => {
            chrome.storage.local.get(['ah_hierarchy'], d => resolve(d?.ah_hierarchy || []));
        });
    },

    async _saveHierarchy(h) {
        return new Promise(resolve => {
            chrome.storage.local.set({ ah_hierarchy: h }, resolve);
        });
    },

    async _syncAddToHierarchy(disc) {
        const h = await this._getHierarchy();
        if (h.some(d => d.id === disc.id || d.name.toLowerCase() === disc.name.toLowerCase())) return;
        h.push({
            id: disc.id,
            name: disc.name,
            icon: '',
            color: disc.color,
            modules: [],
            createdAt: disc.createdAt,
            updatedAt: Date.now()
        });
        await this._saveHierarchy(h);
    },

    async _syncDeleteFromHierarchy(id) {
        let h = await this._getHierarchy();
        const before = h.length;
        h = h.filter(d => d.id !== id);
        if (h.length !== before) await this._saveHierarchy(h);
    },

    async _syncRenameInHierarchy(id, newName) {
        const h = await this._getHierarchy();
        const disc = h.find(d => d.id === id);
        if (disc) {
            disc.name = newName;
            disc.updatedAt = Date.now();
            await this._saveHierarchy(h);
        }
    },

};
