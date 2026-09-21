## trafficcams.vancouver.ca  cameras integration plan

This is plan on integration trafficcams.vancouver.ca as another source of traffic camera iimages.   

There is https://trafficcams.vancouver.ca/ site that provides Vancouver traffic camera images for cameras installed on road intersections. The site does not have metadata or strict API definition. The site follows specific rules though which allow to use there camera images.  

The rules:
- all available cameras are listed in root page https://trafficcams.vancouver.ca/
- the cameras links are in collapsed accordion items and are html links in format like: <a href="/boundary1.htm">E 1st Ave and Boundary Rd</a>
- every intersection page contains 4 traffic camera images for directions, e.g. in page https://trafficcams.vancouver.ca/boundary1.htm there are 4 images: https://trafficcams.vancouver.ca/cameraimages/Boundary1stSNorth.jpg, https://trafficcams.vancouver.ca/cameraimages/Boundary1stSSouth.jpg, https://trafficcams.vancouver.ca/cameraimages/Boundary1stWEast.jpg and https://trafficcams.vancouver.ca/cameraimages/Boundary1stWWest.jpg


To locate the trafficcams.vancouver.ca camera images from the 'roadsight' app the camera pages should be geocoded. The geocoding should be done using GET https://atlas.microsoft.com/geocode service. For description of the road intersection camera page title should be used, e.g. in page `https://trafficcams.vancouver.ca/boundary1.htm` the description is: `<h1 class="display-2">Boundary Rd and E 1st Ave</h1>` . For successful geocoding the word 'and' in the description should be replaced with char '&' and the description should be url encoded, e.g. query=Oak%20St%20%26%20W.%2010th%20Ave.

To keep geocoded camera pages and individual camera links (normally 4 links per page for north, south, east, west) two new DB tables should be created:
- trafficcams.vancouver camera sites with names and geolocations colums
- trafficcams.vancouver cameras with reference to parent records in camera sites and resolved directions (N, S, E, W)  

Separate async services should be create to: 
- inserts/updates the tables after visiting camera html pages
- geocode camera sites