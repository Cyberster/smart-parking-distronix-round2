// Import required libraries
const dotenv = require('dotenv');
const express = require('express')
const mysql = require('mysql')
const mqtt = require('mqtt')

// Initialize environment variables
dotenv.config({ path: './config.env' });

// Initialize mqtt client
const client  = mqtt.connect('mqtt://broker.hivemq.com')

console.log('...')

client.on('connect', function () {
    let topic = 'distronix/parking/metrics/c6fe7f8e-9af6-476b-b226-db637e007499'
    client.subscribe(topic, function (err) {
        if (!err) {
            client.publish(topic, 'published')
        }
    })
})
 
client.on('message', function (topic, message) {
    // message is Buffer
    console.log(message.toString())
    //client.end()
})