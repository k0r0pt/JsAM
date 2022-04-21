# JsAM - The JavaScript Actor Model Framework

## Note

All the development and case studies were run on a 12 Core 24 Thread AMD Ryzen 9 3900X processor with 50.8 GB of RAM. This is important to note in relation to the numbers (processing time and memory consumption) that follow.

The numbers will vary of course, based on the processing power and RAM capacity.

## Considerations for Streamification

### Why we didn't streamify ask and tell operations.

We ran the processing speed with jsam case study for a million actors (1000 parent actors with 1000 child actors each), with each actor reference having a stream open to the node with the actual actor.

* Memory usage of streaming vs not streaming was huge - 32 GB vs 12 GB.
* Time of processing (processing-speed with-jsam case study) was only shaved off by a few seconds - 94 vs 88 seconds.

In conclusion, the time memory trade-off was not worth it. And the staggering number of open streams ended up using a ton of memory.