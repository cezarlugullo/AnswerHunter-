/**
 * StorageModel.js
 * Gerencia a persistência de dados do fichário (Binder) usando chrome.storage.local.
 */
export const StorageModel = {
    data: [],
    currentFolderId: 'root',

    /**
     * Inicializa o storage, carregando dados do chrome.storage.local
     * @returns {Promise<void>}
     */
    async init() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['binderStructure'], (result) => {
                if (result.binderStructure && Array.isArray(result.binderStructure)) {
                    this.data = result.binderStructure;
                } else {
                    // Estrutura inicial padrão
                    this.data = [{ id: 'root', type: 'folder', title: 'Raiz', children: [] }];
                }
                resolve();
            });
        });
    },

    /**
     * Salva o estado atual no storage
     * @returns {Promise<void>}
     */
    async save() {
        console.log('StorageModel: Salvando estrutura...', this.countItems());
        return new Promise((resolve, reject) => {
            chrome.storage.local.set({ binderStructure: this.data }, () => {
                if (chrome.runtime.lastError) {
                    console.error('StorageModel: Erro ao salvar:', chrome.runtime.lastError);
                    reject(chrome.runtime.lastError);
                } else {
                    resolve();
                }
            });
        });
    },

    /**
     * Conta total de questões salvas (recursivo)
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
     * Encontra um nó (pasta ou item) pelo ID
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
     * Adiciona uma nova questão à pasta atual
     * @param {string} question 
     * @param {string} answer 
     * @param {string} source 
     */
    async addItem(question, answer, source) {
        if (!this.data.length) await this.init();

        const current = this.findNode(this.currentFolderId);
        if (current && current.type === 'folder') {
            current.children.push({
                id: 'q' + Date.now(),
                type: 'question',
                content: { question, answer, source },
                createdAt: Date.now()
            });
            await this.save();
        } else {
            console.error('StorageModel: Pasta atual inválida:', this.currentFolderId);
        }
    },

    /**
     * Cria uma nova pasta dentro da pasta atual
     * @param {string} name 
     */
    async createFolder(name) {
        if (!name) return;
        const current = this.findNode(this.currentFolderId);
        if (current && current.type === 'folder') {
            current.children.push({
                id: 'f' + Date.now(),
                type: 'folder',
                title: name,
                children: [],
                createdAt: Date.now()
            });
            await this.save();
        }
    },

    /**
     * Verifica se uma questão já está salva
     * @param {string} questionText 
     * @returns {boolean}
     */
    isSaved(questionText) {
        const search = (nodes) => {
            for (const node of nodes) {
                if (node.type === 'question' && node.content && node.content.question === questionText) return true;
                if (node.children) {
                    if (search(node.children)) return true;
                }
            }
            return false;
        };
        return search(this.data);
    },

    /**
     * Remove uma questão pelo texto do conteúdo
     * @param {string} questionText 
     * @returns {boolean} Sucesso
     */
    async removeByContent(questionText) {
        const removeFromTree = (nodes) => {
            for (let i = 0; i < nodes.length; i++) {
                if (nodes[i].type === 'question' && nodes[i].content && nodes[i].content.question === questionText) {
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
     * Remove um nó pelo ID
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
     * Move um item para outra pasta
     * @param {string} itemId 
     * @param {string} targetFolderId 
     */
    async moveItem(itemId, targetFolderId) {
        if (itemId === targetFolderId) return;

        // Helper para remover e retornar o item
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
            const targetFolder = this.findNode(targetFolderId);
            if (targetFolder && targetFolder.type === 'folder') {
                targetFolder.children.push(itemNode);
                await this.save();
            } else {
                // Se falhar, tenta restaurar recarregando (não é ideal, mas seguro)
                await this.init();
            }
        }
    },

    /**
     * Limpa tudo (Factory Reset)
     */
    async clearAll() {
        this.data = [{ id: 'root', type: 'folder', title: 'Raiz', children: [] }];
        this.currentFolderId = 'root';
        await this.save();
    }
};
