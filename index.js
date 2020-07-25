// Import required libraries
const dotenv = require('dotenv');
const express = require('express')
const mysql = require('mysql')
const mqtt = require('mqtt')

// Initialize environment variables
dotenv.config({ path: './config.env' });

let sensor_timeout = 30 // TODO: replace with process.env.SENSOR_TIMEOUT

const db = require('./db')

// Initialize mqtt client
const client  = mqtt.connect('mqtt://broker.hivemq.com')

console.log('Initializing...')

// Import routes
const sensorRouter 	= require('./routes/sensorRoutes')
const statusRouter 	= require('./routes/statusRoutes')
const lotRouter 	= require('./routes/lotRoutes')
const bayRouter 	= require('./routes/bayRoutes')

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





let sensor_uuids = ['c6fe7f8e-9af6-476b-b226-db637e007499', '44d5ee0d-16a6-44ad-8e4b-c8c84e3595f2']

client.on('connect', function () {
    sensor_uuids.forEach(function(sensor_uuid) {
        let topic = 'distronix/parking/metrics/' + sensor_uuid
        client.subscribe(topic, function (err) {
            if (!err) {
                client.publish(topic, 'error')
            }
        })

        topic = 'distronix/parking/alerts/' + sensor_uuid
        client.subscribe(topic, function (err) {
            if (!err) {
                client.publish(topic, 'error')
            }
        })
    });
})


let timestamp_obj = sensor_uuids.reduce((a, b) => (a[b] = Date.now(), a),{});
//let timestamp_ms = Date.now()

client.on('message', async function (topic, message) {
    // message is Buffer
    console.log('topic: ', topic, 'message: ', message.toString(), message)
    //client.end()

    // Extract uuid from topic
    let parts = topic.split('/')
    let uuid = parts[parts.length - 1]

    // Max wait 30s, then declare as faulty sensor
    let time_diff_s = (Date.now() - timestamp_obj[uuid]) / 1000
    timestamp_ms = Date.now()
    console.log('time_diff_s: ', time_diff_s, 'seconds')




    let is_occupied = (message == 'true')
    let is_faulty = (time_diff_s > sensor_timeout ? true : false) // after 30 sec, set it to 1
    let timestamp = new Date()

    console.log('uuid:', uuid)
    console.log('is_occupied: ', is_occupied, 'is_faulty: ', is_faulty, 'timestamp: ', timestamp)


    if (is_faulty && topic === 'distronix/parking/alerts/' + uuid) {
        client.publish(topic, 'error')
    }


    try {
        // 1. Update sensor table
        let sensor_result = await db.updateSensorByUUID(uuid, is_occupied, is_faulty)
        console.log('sensor_result: ', sensor_result)

        // 2. Add data to status table
        let status_result = await db.addStatusByUUID(uuid, timestamp, is_occupied, is_faulty)
        console.log('status_result: ', status_result)
		//res.json(result)
    } catch (e) {
        console.log(e)
        //res.sendStatus(500)
    }
})