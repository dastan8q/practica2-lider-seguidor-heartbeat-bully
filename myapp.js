//npm instal ...
const express = require("express");
const axios = require("axios");
const cron = require("node-cron");

const PORT = process.argv[2] || 3001;
const NODES = ["http://localhost:3001", "http://localhost:3002", "http://localhost:3003"];
const NODE_ID = parseInt(PORT);

let leader = null;
let dataStore = new Map();
let isLeader = false;

const app = express();
app.use(express.json());

// Almacenar datos (solo en el líder)
app.post("/store", async (req, res) => {
    if (!isLeader) return res.status(403).send("No soy el líder");
    const { key, value } = req.body;
    dataStore.set(key, value);
    await Promise.all(NODES.filter(n => n !== `http://localhost:${PORT}`).map(n =>
        axios.post(`${n}/replica`, { key, value }).catch(() => {})
    ));
    res.send("Dato almacenado");
});

// Replica de datos en los seguidores
app.post("/replica", (req, res) => {
    const { key, value } = req.body;
    dataStore.set(key, value);
    res.send("Replicado");
});

app.get("/data/:key", (req, res) => {
    const { key } = req.params;
    if (dataStore.has(key)) {
        res.json({ key, value: dataStore.get(key) });
    } else {
        res.status(404).send("Clave no encontrada");
    }
});

// Heartbeat del líder
if (PORT === "3001") {
    isLeader = true;
    leader = NODE_ID;
    cron.schedule("*/2 * * * * *", () => {
        NODES.forEach(node => {
            if (node !== `http://localhost:${PORT}`) {
                axios.get(`${node}/heartbeat`).catch(() => {});
            }
        });
    });
}

app.get("/heartbeat", (req, res) => res.send("OK"));

// Detección de fallos y algoritmo Bully
cron.schedule("*/5 * * * * *", async () => {
    if (!isLeader) {
        try {
            await axios.get(`${NODES.find(n => n.includes(leader))}/heartbeat`);
        } catch (err) {
            startElection();
        }
    }
});

const startElection = async () => {
    const higherNodes = NODES.filter(n => parseInt(n.split(":")[2]) > NODE_ID);
    let responseReceived = false;
    
    await Promise.all(higherNodes.map(async node => {
        try {
            await axios.post(`${node}/election`, { id: NODE_ID });
            responseReceived = true;
        } catch (err) {}
    }));

    if (!responseReceived) {
        isLeader = true;
        leader = NODE_ID;
        console.log(`Soy el nuevo líder: ${leader}`);
    }
};

app.post("/election", (req, res) => {
    res.send("OK");
    startElection();
});

app.listen(PORT, () => console.log(`Nodo ${PORT} en ejecución`));

/* llamadas...

node myapp.js 3001
node myapp.js 3002
node myapp.js 3003

http://localhost:3001/heartbeat ... OK

lider actual: http://localhost:3003/store ...Dato almacenado
{
    "key": "usuario1",
    "value": "Mario Fernando"
}

seguidores (3001 o 3002): http://localhost:3002/data/usuario1 ... 
{
    "key": "usuario1",
    "value": "Mario Fernando"
}

La simulacion de Bully se produce al "inhabilitar" el nodo lider actual "Ctrl-C"
Se produce la "Eleccion"
*/