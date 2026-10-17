/*
 * Home page: the leaderboard teaser shows the live Razed top 3 and prize
 * pool, using the same card as the leaderboard at 81.5% scale.
 */
(function () {
  "use strict";

  var R = window.Rekoj;
  var board = R.config.boards.razed;

  // Card art and gift icons exported for the teaser; avatars as on the board.
  var BOX = {
    1: "/assets/home/teaser-box-1st.webp",
    2: "/assets/home/teaser-box-2nd.webp",
    3: "/assets/home/teaser-box-3rd.webp",
  };
  var GIFT = {
    1: "/assets/home/gift-1st.svg",
    2: "/assets/home/gift-2nd.svg",
    3: "/assets/home/gift-3rd.svg",
  };

  function avatarFor(place, entry) {
    if (entry && entry.avatar) return entry.avatar;
    return (board.assets.podiumAvatars || [])[place - 1] || board.assets.rowAvatar;
  }

  function renderPool() {
    // "$3,000" with the comma set smaller, as in the design.
    var el = document.getElementById("teaserPool");
    el.innerHTML = R.esc(board.prizePool).replace(/,/g, '<span class="teaser__comma">,</span>');
  }

  function renderCards(entries) {
    var html = "";
    // Painted 3rd, 2nd, 1st so 1st sits on top, as in the design.
    [3, 2, 1].forEach(function (place) {
      var e = entries[place - 1] || {};
      html +=
        '<div class="teaser__slot teaser__slot--' + place + '">' +
          R.podiumCard({
            place: place,
            entry: e,
            box: BOX[place],
            gift: GIFT[place],
            avatar: avatarFor(place, e),
            prize: e.prize != null ? e.prize : (board.prizes || [])[place - 1] || 0,
            lazy: true,
          }) +
        "</div>";
    });
    document.getElementById("teaserCards").innerHTML = html;
  }

  renderPool();
  renderCards(board.entries || []);
  R.loadBoard("razed").then(renderCards);
})();
