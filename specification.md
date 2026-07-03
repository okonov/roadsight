# RoadSight

**roadsight** project is POC and coding exercise application to get familiar with several technologies. Additionally it will be used as portfolio application.

## Introduction ##
The application provides user ability to create routes and check images from publicly available traffic cameras along the routes.
The application has geographic limits of province of BC, with possible extension to state of WA later. The main source of traffic cameras is [DriveBC webcams](https://ouvert.canada.ca/data/dataset/6b39a910-6c77-476f-ac96-7b4f18849b1c/resource/011d8391-e5d7-4b64-89fc-6869d58fac5d) that uses [Open511 API](https://api.open511.gov.bc.ca/help).  

## Tech stack ##
### Infrastructure ###
Application uses Azure as cloud provider. 
- Authentication: Microsoft Entra External ID
- service hosting: Azure Apps (TBD)
- route planning: Azure Maps
- AI to translate plain text origin/destination to coordinates and to analyze webcam images: Azure Foundry  
- DB: Azure Database for PostgreSQL in production, PostgreSQL in Docker for local development

### Lanuages and frameworks ###
- web: next.js, TypeScript 
- backend: separate auxilary services: .net/c#

### Repository ##
GitHub

### Deployment ###
Docker

## User Stories ##
### Add route 
- user provides route description in general language, e.g. 'Lougheed Mall to Squamish waterfall'
- user checks the origin/destination of the route are properly resolved, confirms the route  

Underlying processing:
- user types general language route description on web page
- web application creates new record for the route in DB and saves the description
- web application sends the general description to Azure Foundry to resolve formal origin and destination with coordinates latitude/longitude
- web page adds origin/destination to the route for user to confirm/save
- web page sends route coordinates to Azure Maps to get route polyline and saves most recommended to the root record in DB (DB type to be defined: relational DB, e.g. Postgres seems OK for everything,  though persisting route polyline should be confirmed)
