<template>
  <div>
    <div v-if="ready" class="zd primary">
      <div class="bar">
        <div>
          <div class="menu">
            <ul class="panel">
              <li class="icon-panel">Zaideih</li>
            </ul>
            <ul class="nav">
              <li>
                <router-link :to="{ path: '/' }" class="home icon-home-">
                  <span>Home</span>
                </router-link>
              </li>
              <li>
                <router-link :to="{ path: '/artist' }" class="icon-artist-">
                  <span>Artist</span>
                </router-link>
              </li>
              <router-link :to="{ path: '/album' }" class="icon-album-" v-slot="{ isActive, href, navigate }">
                <li :class="{ active: isActive }">
                  <a :href="href" @click="navigate">
                    <span>Album</span>
                  </a>
                </li>
              </router-link>
              <router-link :to="{ path: '/queue' }" :data-count="dataStore.totalQueue"
                class="icon-list-bullet-" v-slot="{ isActive, href, navigate }">
                <li :class="{ active: isActive }">
                  <a :href="href" @click="navigate">
                    <span>Queue</span>
                  </a>
                </li>
              </router-link>
            </ul>
          </div>

          <div class="opt">
            <ul>
              <li class="icon-config-"></li>
            </ul>
          </div>
        </div>
      </div>
      <div class="sch">
        <form v-on:submit="search" name="search" method="get" action="#">
          <div class="logo">
            <span>Zaideih</span>
          </div>
          <div class="type">
            <input v-model="dataStore.searchQuery" placeholder=" Type here..." type="search">
          </div>
          <div class="option">
            <input v-model="dataStore.searchAt" value="title" id="title" type="radio">
            <label for="title" title="Title" class="icon-track">Title</label>
            <input v-model="dataStore.searchAt" value="artist" id="artist" type="radio">
            <label for="artist" title="Artist" class="icon-artist">Artist</label>
            <input v-model="dataStore.searchAt" value="album" id="album" type="radio">
            <label for="album" title="Album" class="icon-album">Album</label>
            <input v-model="dataStore.searchAt" value="avekpi" id="avekpi" type="radio">
            <label for="avekpi" title="All" class="icon-database">All</label>
          </div>
          <div class="submit">
            <button type="submit" title="Search" class="icon-search"></button>
          </div>
        </form>
      </div>
      <router-view class="wrapper"></router-view>
    </div>
    <div v-else class="zd fullscreen loading">
      <p class="t2 trial">one moment</p>
    </div>
    <div class="zd player">
      <Player ref="player" />
    </div>
  </div>
</template>

<script>
// Option A: Keep pointing to your external file
import script from './layout.js';
export default script;

// Option B: If you prefer to paste your layout.js content here, 
// remove the import above and paste the export default { ... } block here.
</script>

<style scoped>
/* If you have an external CSS file, you can also import it here:
@import "./layout.css"; 
*/
</style>