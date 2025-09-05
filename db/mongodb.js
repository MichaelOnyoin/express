// lib/mongodb.js
const { MongoClient } = require("mongodb")

const uri = process.env.MONGODB_ATLAS_URI
const options = {}

let client
let clientPromise

if (!process.env.MONGODB_ATLAS_URI) {
  throw new Error('Please add your MongoDB URI to .env')
}

if (process.env.NODE_ENV === 'development') {
  // In dev, use a global variable so the value is preserved across hot reloads
  if (!global._mongoClientPromise) {
    client = new MongoClient(uri, options)
    global._mongoClientPromise = client.connect()
  }
  clientPromise = global._mongoClientPromise
} else {
  // In production (serverless), don't use global. Just reuse the promise if possible.
  client = new MongoClient(uri, options)
  clientPromise = client.connect()
  console.log("✅ Connected to MongoDB");
}

module.exports = clientPromise
