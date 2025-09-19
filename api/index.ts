// api/index.js

//import { AzureOpenAI } from "@langchain/openai";

//const {MongoClient} = require("mongodb")
const express = require('express');
const path = require('path');
const cors = require('cors')
const app = express();
require('dotenv/config')
app.use(cors())// Enable CORS for all routes
app.use(express.json()) // Parse JSON request bodies
const {clientPromise} = require('../db/mongodb');
const {GoogleGenerativeAIEmbeddings} = require('@langchain/google-genai')
const {ChatGoogleGenerativeAI} = require('@langchain/google-genai')
const { AIMessage, BaseMessage, HumanMessage } = require("@langchain/core/messages") // Message types for conversations
const {
  ChatPromptTemplate,      // For creating structured prompts with placeholders
  MessagesPlaceholder,     // Placeholder for dynamic message history
} = require("@langchain/core/prompts") 
const { StateGraph } = require("@langchain/langgraph")              // State-based workflow orchestration
const { Annotation } = require("@langchain/langgraph")               // Type annotations for state management             
const { tool } = require('@langchain/core/tools') // For creating custom tools/functions
const { ToolNode } = require("@langchain/langgraph/prebuilt")// Pre-built node for executing tools
const { MongoDBSaver } = require("@langchain/langgraph-checkpoint-mongodb")  // For saving conversation state
const { MongoDBAtlasVectorSearch } = require("@langchain/mongodb")    // Vector search integration with MongoDB
const { z } = require("zod")    // Schema validation library
const { MongoClient } = require("mongodb")
const {AzureEmbeddings} = require("@langchain/azure-openai")

const uri = process.env.MONGODB_ATLAS_URI
const options = {}
const client = new MongoClient(uri, options) 
async function handler(req, res) {
  try {
    const client = await clientPromise
    const db = client.db('inventory_database')
    const collection = db.collection('items')

    const data = await collection.find({}).toArray()

    res.status(200).json({ success: true, data })
  } catch (error) {
    console.error('Error in callAgent:', error)
    res.status(500).json({ success: false, message: 'Internal Server Error' })
  }
}

// const client = new MongoClient(process.env.MONGODB_ATLAS_URI || 'mongodb+srv://michaelonyoin:mongodb@cluster0.jidc3.mongodb.net' )
// async function run() {
// try {
//     const client = await clientPromise
//     const db = client.db('inventory_database')
//     const collection = db.collection('items')

//     //const data = await collection.find({}).toArray()

//     //res.status(200).json({ success: true, data })
//   } catch (error) {
//     console.error('Error in callAgent:', error)
//     //res.status(500).json({ success: false, message: 'Internal Server Error' })
//   }
//  }
//  run();

async function retryWithBackoff(fn, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (error.status === 429 && attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
        console.log(`Rate limit hit. Retrying in ${delay / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw new Error("Max retries exceeded");
}



// Serve static files from /public
app.use(express.static(path.join(__dirname, '..', 'public')));

// Home route - HTML
app.get('/', (req, res) => {
  res.status(200).send(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8"/>
        <title>Express on Vercel</title>
        <link rel="stylesheet" href="/style.css" />
      </head>
      <body>
        <nav>
          <a href="/">Home</a>
          <a href="/about">About</a>
          <a href="/api-data">API Data</a>
          <a href="/healthz">Health</a>
          <a href="/ai">AI</a>
        </nav>
        <h1>Welcome to Express on Vercel 🚀</h1>
        <p>This is a minimal example without a database or forms.</p>
        <img src="/logo.png" alt="Logo" width="120" />
      </body>
    </html>
  `);
});

app.post('/chat', async (req, res) => {
      // Extract user message from request body
      //const client = await clientPromise
      const initialMessage = req.body.message
      // Generate unique thread ID using current timestamp
      const threadId = Date.now().toString()
      // Log the incoming message for debugging
      console.log(initialMessage)
      try {
        // Call our AI agent with the message and new thread ID
        const response = await callAgent(client, initialMessage, threadId)
        // Send successful response with thread ID and AI response
        res.json({ threadId, response })
      } catch (error) {
        // Log any errors that occur during agent execution
        console.error('Error starting conversation:', error)
        // Send error response with 500 status code
        res.status(500).json({ error: 'Internal server error' })
      }
    })

    // Define endpoint for continuing existing conversations (POST /chat/:threadId)
app.post('/chat/:threadId', async (req, res) => {
      //const client = await clientPromise
      // Extract thread ID from URL parameters
      const { threadId } = req.params
      // Extract user message from request body
      const { message } = req.body
      try {
        // Call AI agent with message and existing thread ID (continues conversation)
        const response = await callAgent(client, message, threadId)
        // Send AI response (no need to send threadId again since it's continuing)
        res.json({ response })
      } catch (error) {
        // Log any errors that occur during agent execution
        console.error('Error in chat:', error)
        // Send error response with 500 status code
        res.status(500).json({ error: 'Internal server error' })
      }
    })

app.get('/about', function (req, res) {
	res.sendFile(path.join(__dirname, '..', 'components', 'about.htm'));
});

app.get('/ai', function (req, res) {
	res.sendFile(path.join(__dirname, '..', 'components', 'ai.html'));
});

// Example API endpoint - JSON
app.get('/api-data', (req, res) => {
  res.json({
    message: 'Here is some sample API data',
    items: ['apple', 'banana', 'cherry']
  });
});

// Health check
app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

//AI-Agent endpoint
app.get('/api/ai-agent', (req, res) => {
  res.json({
    message: 'AI Agent endpoint is under construction'
  });
});

// Local dev listener (ignored on Vercel)
app.listen(8000, () => console.log('Server running on http://localhost:8000'));

module.exports = app;

// Utility function to handle API rate limits with exponential backoff
// Main function that creates and runs the AI agent
async function callAgent(client, query, thread_id) {
  try {
    const dbName = "inventory_database";
    const db = client.db(dbName);
    const collection = db.collection("items");

    const GraphState = Annotation.Root({
      messages: Annotation({
        reducer: (x, y) => x.concat(y),
      }),
    });

    const itemLookupTool = tool(
      async ({ query, n = 10 }) => {
        try {
          console.log("Item lookup tool called with query:", query);

          const totalCount = await collection.countDocuments();
          console.log(`Total documents in collection: ${totalCount}`);

          if (totalCount === 0) {
            console.log("Collection is empty");
            return JSON.stringify({ 
              error: "No items found in inventory", 
              message: "The inventory database appears to be empty",
              count: 0 
            });
          }

          const sampleDocs = await collection.find({}).limit(3).toArray();
          console.log("Sample documents:", sampleDocs);

          const dbConfig = {
            collection: collection,
            indexName: "vector_index",
            textKey: "embedding_text",
            embeddingKey: "embedding",
          };
          // Initialize vector store with Google or Azure embeddings
          const vectorStore = new MongoDBAtlasVectorSearch(
            new GoogleGenerativeAIEmbeddings({
              apiKey: process.env.GOOGLE_API_KEY,
              model: "text-embedding-004",
            }),
            dbConfig
          );
          // const vectorStore = new MongoDBAtlasVectorSearch(
            
          //   new AzureEmbeddings({
          //     deploymentName: process.env.AZURE_EMBEDDING_DEPLOYMENT_NAME || "text-embedding-ada-002",
          //     model: process.env.AZURE_EMBEDDING_MODEL || "text-embedding-ada-002",
          //     apiKey: process.env.AZURE_API_KEY || "",
          //     endpoint: process.env.AZURE_ENDPOINT || "",
          //   }),
          //   dbConfig
          // );

          console.log("Performing vector search...");
          const result = await vectorStore.similaritySearchWithScore(query, n);
          console.log(`Vector search returned ${result.length} results`);

          if (result.length === 0) {
            console.log("Vector search returned no results, trying text search...");
            const textResults = await collection.find({
              $or: [
                { item_name: { $regex: query, $options: 'i' } },
                { item_description: { $regex: query, $options: 'i' } },
                { categories: { $regex: query, $options: 'i' } },
                { embedding_text: { $regex: query, $options: 'i' } }
              ]
            }).limit(n).toArray();

            console.log(`Text search returned ${textResults.length} results`);
            return JSON.stringify({
              results: textResults,
              searchType: "text",
              query: query,
              count: textResults.length
            });
          }

          return JSON.stringify({
            results: result,
            searchType: "vector",
            query: query,
            count: result.length
          });

        } catch (error) {
          console.error("Error in item lookup:", error);
          console.error("Error details:", {
            message: error.message,
            stack: error.stack,
            name: error.name
          });
          
          return JSON.stringify({ 
            error: "Failed to search inventory", 
            details: error.message,
            query: query
          });
        }
      },
      {
        name: "item_lookup",
        description: "Gathers furniture item details from the Inventory database",
        schema: z.object({
          query: z.string().describe("The search query"),
          n: z.number().optional().default(10)
            .describe("Number of results to return"),
        }),
      }
    );

    const tools = [itemLookupTool];
    const toolNode = new ToolNode(tools);

    const model = new ChatGoogleGenerativeAI({
      model: "gemini-1.5-flash",
      temperature: 0,
      maxRetries: 0,
      apiKey: process.env.GOOGLE_API_KEY,
    }).bindTools(tools);

    // const model = new AzureOpenAI({
    //   apiKey: process.env.AZURE_API_KEY,
    //   endpoint: process.env.AZURE_ENDPOINT,
    //   deploymentName: process.env.AZURE_DEPLOYMENT_NAME,
    //   model: process.env.AZURE_MODEL,
    // }).asTool(tools);

    function shouldContinue(state) {
      const messages = state.messages;
      const lastMessage = messages[messages.length - 1];

      if (lastMessage.tool_calls?.length) {
        return "tools";
      }
      return "__end__";
    }

async function callModel(state) {
  return retryWithBackoff(async () => {
    // Create a structured prompt template
    const prompt = ChatPromptTemplate.fromMessages([
      [
        "system",
        `You are a helpful E-commerce Chatbot Agent for a furniture store. 

        IMPORTANT: You have access to an item_lookup tool that searches the furniture inventory database. ALWAYS use this tool when customers ask about furniture items, even if the tool returns errors or empty results.

        When using the item_lookup tool:
        - If it returns results, provide helpful details about the furniture items
        - If it returns an error or no results, acknowledge this and offer to help in other ways
        - Always try to summarize the retrieved information in a user-friendly way (Use less words)
        - If the database appears to be empty, let the customer know that inventory might be being updated
        - Talk only about the first 3 relevant items you find, unless the customer asks for more

        Current time: {time}`,
      ],
      new MessagesPlaceholder("messages"),
    ]);

    // Fill in the prompt template with actual values
    const formattedPrompt = await prompt.formatMessages({
      time: new Date().toISOString(),
      messages: state.messages,
    });

    // Call the AI model with the formatted prompt
    const result = await model.invoke(formattedPrompt);

    // Return new state with the AI's response added
    return { messages: [result] };
  });
}

// Build the workflow graph
const workflow = new StateGraph(GraphState)
  .addNode("agent", callModel)                  
  .addNode("tools", toolNode)                   
  .addEdge("__start__", "agent")                
  .addConditionalEdges("agent", shouldContinue) 
  .addEdge("tools", "agent");                   

// Initialize conversation state persistence
const checkpointer = new MongoDBSaver({ client, dbName });

// Compile the workflow with state saving
const app = workflow.compile({ checkpointer });

// Execute the workflow
const finalState = await app.invoke(
  {
    messages: [new HumanMessage(query)], 
  },
  { 
    recursionLimit: 15,
    configurable: { thread_id: thread_id }
  }
);

// Extract the final response from the conversation
const response = finalState.messages[finalState.messages.length - 1].content;
console.log("Agent response:", response);
return response;

} 
catch (error) {
  console.error("Error in callAgent:", error.message);

  if (error.status === 429) {
    throw new Error("Service temporarily unavailable due to rate limits. Please try again in a minute.");
  } else if (error.status === 401) {
    throw new Error("Authentication failed. Please check your API configuration.");
  } else {
    throw new Error(`Agent failed: ${error.message}`);
  }
}

}