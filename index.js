// Import required libraries
const dotenv = require('dotenv');
const express = require('express')
const mysql = require('mysql')
const mqtt = require('mqtt')
const fs = require('fs')

// Initialize environment variables
dotenv.config({ path: __dirname + '/config.env' });

let sensor_timeout = process.env.SENSOR_TIMEOUT

const db = require('./db')

// Initialize mqtt client
const client  = mqtt.connect('mqtt://broker.hivemq.com')

console.log('Initializing server...')


// Import routes
const sensorRouter 	= require('./routes/sensorRoutes')
const statusRouter 	= require('./routes/statusRoutes')
const lotRouter 	= require('./routes/lotRoutes')
const bayRouter 	= require('./routes/bayRoutes');
const { time } = require('console');

// Initialize app variable
const app = express()

// Configuring the listening port
app.listen(process.env.PORT, () => {
	console.log('Server is running on port: ' + process.env.PORT)
})


// Processing middlewares
app.use(express.urlencoded({ extended: true })) // Required for accepting form data

// Print request headers
app.use('*', (req, res, next) => {
    console.log('Request received:');
    //console.log(JSON.stringify(req.headers));
    
    for (var key of Object.keys(req.headers)) {
        console.log(key + ": " + req.headers[key])
    }
    
    next()
})

app.use('/sensor', sensorRouter)
app.use('/data', statusRouter)
app.use('/lot', lotRouter)
app.use('/bay', bayRouter)


// Handling 404 page
app.use((req, res) => {
	let message = {
		statu: 'error',
		message: '404 - Not found'
	}
    res.status(404).json(message)
})




let sensor_uuids = {}
let file = fs.readFile('sensors.json', function(err, data) {
    if (err) return

    sensor_uuids = JSON.parse(data.toString())

    client.on('connect', function () {
        sensor_uuids.forEach(function(sensor_uuid) {
            let topic = 'distronix/parking/metrics/' + sensor_uuid

            client.subscribe(topic, function (err) {
                if (!err) {
                    // client.publish(topic, 'error')
                    console.log('Unable to subscribe to the topic:', topic)
                }
            })

            // topic = 'distronix/parking/alerts/' + sensor_uuid

            // client.subscribe(topic, function (err) {
            //     if (!err) {
            //         // client.publish(topic, 'error')
            //         console.log('Unable to subscribe to the topic:', topic)
            //     }
            // })
        });
    })

    // client.on('offline', async function (topic, message) {
    //     console.log(topic, message)
    // })
    // client.on('close', async function (topic, message) {
    //     console.log(topic, message)
    // })
    // client.on('error', async function (topic, message) {
    //     console.log(topic, message)
    // })
    // client.on('end', async function (topic, message) {
    //     console.log(topic, message)
    // })

    let obj = {
        sec_elapse: 0,
        is_occupied: 0,
        is_faulty: 0,
        timestamp: Date.now()
    }
    let sensor_data = sensor_uuids.reduce((a, b) => (a[b] = obj, a), {});
    console.log(sensor_data)
    //let timestamp_ms = Date.now()


    // https://stackoverflow.com/a/53932648
    function isSensorActive() {
        sensor_uuids.forEach(async function(sensor_uuid) {
            if (sensor_data[sensor_uuid].sec_elapse >= sensor_timeout) {
                sensor_data[sensor_uuid].sec_elapse = 0
                
                // update db
                console.log('sensor_data:', sensor_data)

                let is_occupied = sensor_data[sensor_uuid].is_occupied // Last good known data
                let is_faulty = 1 // Faulty sensor
                let timestamp = new Date() // current timestamp

                sensor_data[sensor_uuid].is_faulty = is_faulty
                sensor_data[sensor_uuid].timestamp = timestamp

                try {
                    // 1. Update sensor table
                    let sensor_result = await db.updateSensorByUUID(sensor_uuid, is_occupied, is_faulty)
                    console.log('sensor_result: ', sensor_result)
        
                    // 2. Add data to status table
                    let status_result = await db.addStatusByUUID(sensor_uuid, timestamp, is_occupied, is_faulty)
                    console.log('status_result: ', status_result)

                    // 3. publish message to the broker
                    topic = 'distronix/parking/alerts/' + sensor_uuid
                    client.publish(topic, 'Error: Faulty sensor!')

                    //console.log('sensor_data:', sensor_data)
                    console.log('uuid:', sensor_uuid, 'is_occupied', is_occupied, 'is_faulty', is_faulty, 'timestamp', timestamp)
                } catch (e) {
                    console.log(e)
                    //res.sendStatus(500)
                }
            } else {
                sensor_data[sensor_uuid].timestamp = new Date()
                sensor_data[sensor_uuid].sec_elapse++
            }
        })

        // console.log('isSensorActive:', Date.now(), 'sensor_data:', sensor_data)
        //console.log('sensor_data:', sensor_data)
    }
    setInterval(async () => {
        await isSensorActive()
    }, 1000);


    client.on('message', async function (topic, message) {
        // message is Buffer
        console.log('topic: ', topic, 'message: ', message.toString(), message)
        //client.end()

        // Extract uuid from topic
        let parts = topic.split('/')
        let uuid = parts[parts.length - 1]

        let is_occupied = (message == 'true')
        let is_faulty = 0 // Getting signal, so not faulty sensor
        let timestamp = new Date() // current timestamp

        console.log('uuid:', uuid)
        console.log('is_occupied: ', is_occupied, 'is_faulty: ', is_faulty, 'timestamp: ', timestamp)

        sensor_data[uuid].is_occupied = is_occupied
        sensor_data[uuid].is_faulty = is_faulty
        sensor_data[uuid].timestamp = timestamp

        try {
            // 1. Update sensor table
            let sensor_result = await db.updateSensorByUUID(uuid, is_occupied, is_faulty)
            console.log('sensor_result: ', sensor_result)

            // 2. Add data to status table
            let status_result = await db.addStatusByUUID(uuid, timestamp, is_occupied, is_faulty)
            console.log('status_result: ', status_result)
        } catch (e) {
            console.log(e)
            //res.sendStatus(500)
        }
    })
})
