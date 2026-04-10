// IndexedDB 存储管理器

import type { ToolSet } from '@/types/toolset'

export class StorageManager {
  private db: IDBDatabase | null = null

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('YOSO_DB', 1)

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result

        if (!db.objectStoreNames.contains('toolsets')) {
          const store = db.createObjectStore('toolsets', { keyPath: 'id' })
          store.createIndex('by-name', 'name', { unique: false })
          store.createIndex('by-updatedAt', 'updatedAt', { unique: false })
        }
      }

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result
        resolve()
      }

      request.onerror = () => reject(request.error)
    })
  }

  private getStore(mode: IDBTransactionMode = 'readonly'): IDBObjectStore {
    if (!this.db) throw new Error('Database not initialized')
    const tx = this.db.transaction('toolsets', mode)
    return tx.objectStore('toolsets')
  }

  async listToolSets(): Promise<ToolSet[]> {
    return new Promise((resolve, reject) => {
      const store = this.getStore()
      const request = store.index('by-updatedAt').getAll()
      request.onsuccess = () => resolve((request.result as ToolSet[]).reverse())
      request.onerror = () => reject(request.error)
    })
  }

  async getToolSet(id: string): Promise<ToolSet | null> {
    return new Promise((resolve, reject) => {
      const store = this.getStore()
      const request = store.get(id)
      request.onsuccess = () => resolve(request.result ?? null)
      request.onerror = () => reject(request.error)
    })
  }

  async saveToolSet(toolSet: ToolSet): Promise<void> {
    return new Promise((resolve, reject) => {
      const store = this.getStore('readwrite')
      const request = store.put(toolSet)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async deleteToolSet(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const store = this.getStore('readwrite')
      const request = store.delete(id)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }
}

export const storageManager = new StorageManager()
